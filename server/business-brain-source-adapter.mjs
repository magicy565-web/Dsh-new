import { digest, fail, safeJson } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';

const DAY = 24 * 60 * 60 * 1000;
const INQUIRY_WINDOW_DAYS = 30;
const STALE_INQUIRY_DAYS = 7;

const PIPELINE_FIELDS = Object.freeze(['metricType', 'windowStart', 'windowEnd', 'eligible', 'progressed', 'pending', 'unknown']);
const AGING_FIELDS = Object.freeze(['metricType', 'windowStart', 'windowEnd', 'eligible', 'progressed', 'pending', 'stale', 'staleThresholdDays']);
const PRODUCT_FIELDS = Object.freeze(['metricType', 'asOf', 'total', 'active', 'complete', 'incomplete', 'archived', 'missingImages', 'missingSkus', 'missingDocuments', 'missingSupply']);

const parseTime = value => {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
};
const dayStart = time => Math.floor(time / DAY) * DAY;
const iso = time => new Date(time).toISOString();
const activeInquiry = row => ['shared', 'replied'].includes(row?.status);
const hasReply = row => Array.isArray(row?.replies) && row.replies.length > 0;

function latestInquiryActivity(rows, fallback) {
  const times = [];
  for (const row of rows) {
    for (const value of [row?.updatedAt, row?.createdAt, row?.publishedAt, row?.sentAt, row?.share?.createdAt, row?.share?.revokedAt]) {
      const parsed = parseTime(value);
      if (parsed !== null) times.push(parsed);
    }
    for (const reply of Array.isArray(row?.replies) ? row.replies : []) {
      for (const value of [reply?.updatedAt, reply?.createdAt]) {
        const parsed = parseTime(value);
        if (parsed !== null) times.push(parsed);
      }
    }
  }
  return times.length ? Math.max(...times) : fallback;
}

function latestProductActivity(products, fallback) {
  const times = products.map(product => parseTime(product?.updatedAt)).filter(time => time !== null);
  return times.length ? Math.max(...times) : fallback;
}

function snapshot(state, workspaceId, clock) {
  const now = clock();
  // Use completed UTC days as the observation window. A moving "now" window
  // would change the source revision every refresh even when the business data
  // has not changed, which would make Brain context revalidation impossible.
  const endTime = dayStart(now);
  const startTime = endTime - INQUIRY_WINDOW_DAYS * DAY;
  const start = iso(startTime);
  const end = iso(endTime);

  const rows = (state.supplyNetwork?.inquiries || [])
    .filter(row => row?.workspaceId === workspaceId)
    .filter(row => {
      const created = parseTime(row.createdAt);
      return created !== null && created >= startTime && created < endTime;
    });

  const eligibleRows = rows.filter(activeInquiry);
  const pendingRows = eligibleRows.filter(row => !hasReply(row));
  const progressedRows = eligibleRows.filter(hasReply);
  const staleRows = pendingRows.filter(row => {
    const created = parseTime(row.createdAt);
    return created !== null && now - created >= STALE_INQUIRY_DAYS * DAY;
  });

  const products = Array.isArray(state.businessLibrary?.products) ? state.businessLibrary.products : [];
  const activeProducts = products.filter(product => product?.status !== 'archived');
  const archivedProducts = products.length - activeProducts.length;
  const incomplete = activeProducts.filter(product => {
    const supply = product?.supply || {};
    return !String(product?.description || '').trim()
      || !String(product?.category || '').trim()
      || !Array.isArray(product?.skus) || product.skus.length === 0
      || !Array.isArray(product?.images) || product.images.length === 0
      || !Array.isArray(product?.documents) || product.documents.length === 0
      || Object.values(supply).some(value => !String(value || '').trim());
  });
  const missingImages = activeProducts.filter(product => !Array.isArray(product?.images) || product.images.length === 0).length;
  const missingSkus = activeProducts.filter(product => !Array.isArray(product?.skus) || product.skus.length === 0).length;
  const missingDocuments = activeProducts.filter(product => !Array.isArray(product?.documents) || product.documents.length === 0).length;
  const missingSupply = activeProducts.filter(product => Object.values(product?.supply || {}).some(value => !String(value || '').trim())).length;

  const pipeline = {
    metricType: 'inquiry-pipeline-v1',
    windowStart: start,
    windowEnd: end,
    eligible: eligibleRows.length,
    progressed: progressedRows.length,
    pending: pendingRows.length,
    unknown: 0
  };
  const aging = {
    metricType: 'inquiry-aging-v1',
    windowStart: start,
    windowEnd: end,
    eligible: eligibleRows.length,
    progressed: progressedRows.length,
    pending: pendingRows.length,
    stale: staleRows.length,
    staleThresholdDays: STALE_INQUIRY_DAYS
  };
  const product = {
    metricType: 'product-completeness-v1',
    asOf: iso(dayStart(now)),
    total: products.length,
    active: activeProducts.length,
    complete: activeProducts.length - incomplete.length,
    incomplete: incomplete.length,
    archived: archivedProducts,
    missingImages,
    missingSkus,
    missingDocuments,
    missingSupply
  };

  return {
    refs: [
      { id: 'supply-inquiry-pipeline', values: pipeline, fields: PIPELINE_FIELDS, observedAt: iso(latestInquiryActivity(rows, endTime)) },
      { id: 'supply-inquiry-aging', values: aging, fields: AGING_FIELDS, observedAt: iso(latestInquiryActivity(rows, endTime)) },
      { id: 'library-product-completeness', values: product, fields: PRODUCT_FIELDS, observedAt: iso(latestProductActivity(products, dayStart(now))) }
    ]
  };
}

function authorize(identity, workspaceId) {
  if (!identity?.workspaceId || identity.workspaceId !== workspaceId) throw new Error('BRAIN_SOURCE_SCOPE_MISMATCH');
}

function makeReference(id, values, fields) {
  return {
    kind: 'metric',
    id,
    revision: digest({ source: id, values }),
    sha256: digest(values),
    fields: [...fields]
  };
}

function buildSnapshot(state, workspaceId, clock) {
  return snapshot(state, workspaceId, clock).refs.map(entry => ({
    reference: makeReference(entry.id, entry.values, entry.fields),
    observedAt: entry.observedAt,
    values: entry.values
  }));
}

/**
 * Read-only projections over existing Workspace business state.
 *
 * This is not a second business database: the adapter only derives bounded
 * metrics from the existing supply-network inquiries and product library.
 * It never exposes buyer notes, identities, credentials, or raw documents.
 */
export function createBusinessBrainSourceAdapter({ store, workspaceId = 'local', clock = Date.now } = {}) {
  if (!store?.read) throw new TypeError('Workspace store is required.');

  function current(identity) {
    authorize(identity, workspaceId);
    return buildSnapshot(store.read(), workspaceId, clock);
  }

  return Object.freeze({
    async list({ identity } = {}) {
      return current(identity).map(item => item.reference);
    },

    async read({ identity, reference } = {}) {
      const item = current(identity).find(entry =>
        entry.reference.kind === reference?.kind &&
        entry.reference.id === reference?.id
      );
      if (!item || item.reference.revision !== reference?.revision || item.reference.sha256 !== reference?.sha256) {
        throw new Error('BRAIN_SOURCE_CHANGED');
      }
      return safeJson({
        workspaceId,
        reference: item.reference,
        observedAt: item.observedAt,
        validUntil: null,
        values: item.values
      }, 32 * 1024);
    },

    current({ identity, reference, expected } = {}) {
      const item = current(identity).find(entry =>
        entry.reference.kind === reference?.kind &&
        entry.reference.id === reference?.id
      );
      if (!item || !expected || expected.workspaceId !== workspaceId || JSON.stringify(item.reference) !== JSON.stringify(expected.reference)
        || item.observedAt !== expected.observedAt || JSON.stringify(item.values) !== JSON.stringify(expected.values)) {
        throw new Error('BRAIN_SOURCE_CHANGED');
      }
      return {
        workspaceId,
        reference: item.reference,
        observedAt: item.observedAt,
        validUntil: null,
        values: item.values
      };
    }
  });
}

function prefixedReference(prefix, reference) {
  return { ...reference, id: prefix + reference.id };
}

/**
 * Compose read-only Brain source adapters without creating a second data
 * authority. Each extra adapter is namespace-prefixed at the Brain boundary,
 * so source IDs can never collide with the primary adapter or another extra.
 */
export function composeBusinessBrainSourceAdapters({ primary, extras = [] } = {}) {
  const valid = adapter => adapter && typeof adapter.list === 'function' && typeof adapter.read === 'function' && typeof adapter.current === 'function';
  if (!valid(primary) || !Array.isArray(extras) || extras.length > 12) throw new TypeError('A primary Brain source adapter and bounded extras are required.');
  const entries = extras.map(extra => {
    if (!extra || typeof extra.prefix !== 'string' || !/^[A-Za-z0-9_.:-]{1,48}$/u.test(extra.prefix) || !valid(extra.adapter))
      throw new TypeError('Brain source adapter prefixes must be bounded and explicit.');
    return Object.freeze({ prefix: extra.prefix, adapter: extra.adapter });
  });
  const prefixes = entries.map(entry => entry.prefix);
  if (new Set(prefixes).size !== prefixes.length) throw new TypeError('Brain source adapter prefixes must be unique.');

  async function list(args = {}) {
    const primaryRefs = await primary.list(args);
    if (!Array.isArray(primaryRefs)) throw new Error('BRAIN_SOURCE_CATALOG_INVALID');
    const ids = new Set(), rawIds = new Set();
    const all = [];
    for (const reference of primaryRefs) {
      if (!reference || reference.kind !== 'metric' || typeof reference.id !== 'string') fail('BRAIN_SOURCE_CATALOG_INVALID');
      if (entries.some(entry => reference.id.startsWith(entry.prefix))) fail('BRAIN_SOURCE_ID_CONFLICT');
      const identity = `${reference.kind}:${reference.id}`;
      if (ids.has(identity)) fail('BRAIN_SOURCE_ID_CONFLICT');
      ids.add(identity); rawIds.add(identity);
      all.push(reference);
    }
    for (const entry of entries) {
      const refs = await entry.adapter.list(args);
      if (!Array.isArray(refs)) throw new Error('BRAIN_SOURCE_CATALOG_INVALID');
      for (const reference of refs) {
        if (!reference || reference.kind !== 'metric' || typeof reference.id !== 'string') fail('BRAIN_SOURCE_CATALOG_INVALID');
        if (reference.id.startsWith(entry.prefix)) fail('BRAIN_SOURCE_ID_CONFLICT');
        const rawIdentity=`${reference.kind}:${reference.id}`;
        if(rawIds.has(rawIdentity))fail('BRAIN_SOURCE_ID_CONFLICT');rawIds.add(rawIdentity);
        const prefixed = prefixedReference(entry.prefix, reference);
        const identity = `${prefixed.kind}:${prefixed.id}`;
        if (ids.has(identity)) fail('BRAIN_SOURCE_ID_CONFLICT');
        ids.add(identity);
        all.push(prefixed);
      }
    }
    return all;
  }

  function owner(reference) {
    if (reference?.kind !== 'metric' || typeof reference.id !== 'string') return null;
    const entry = entries.find(candidate => reference.id.startsWith(candidate.prefix));
    return entry || null;
  }

  function localReference(entry, reference) {
    const id = reference.id.slice(entry.prefix.length);
    if (!id) throw new Error('BRAIN_SOURCE_NOT_SELECTED');
    return { ...reference, id };
  }

  async function read(args = {}) {
    const entry = owner(args.reference);
    if (!entry) return primary.read(args);
    const row = await entry.adapter.read({ ...args, reference: localReference(entry, args.reference) });
    const expectedId = args.reference.id;
    if (!row?.reference || row.reference.id !== args.reference.id.slice(entry.prefix.length)) throw new Error('BRAIN_SOURCE_SCOPE_MISMATCH');
    return { ...row, reference: prefixedReference(entry.prefix, row.reference) };
  }

  function current(args = {}) {
    const entry = owner(args.reference);
    if (!entry) return primary.current(args);
    const local = localReference(entry, args.reference);
    const expected = args.expected ? { ...args.expected, reference: localReference(entry, args.expected.reference) } : args.expected;
    const row = entry.adapter.current({ ...args, reference: local, expected });
    if (!row?.reference || row.reference.id !== local.id) throw new Error('BRAIN_SOURCE_SCOPE_MISMATCH');
    return { ...row, reference: prefixedReference(entry.prefix, row.reference) };
  }

  return Object.freeze({ list, read, current });
}
