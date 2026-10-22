import { digest, fail, safeJson, same } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';
import { productSupplyMissing } from './brain-product-completeness.mjs';

const DAY = 24 * 60 * 60 * 1000;
const INQUIRY_WINDOW_DAYS = 30;
const STALE_INQUIRY_DAYS = 7;

// Each metric is also a self-describing observation. `id` is the stable logical
// metric id (independent of the window) so a decision can keep naming the same
// KPI, while `value`/`unit`/`windowStart`/`windowEnd`/`coverageComplete` are the
// fields the decision layer needs to assess a later outcome. An empty cohort is
// never reported as complete coverage: zero rows is not sufficient evidence.
const PIPELINE_FIELDS = Object.freeze(['id', 'metricType', 'windowStart', 'windowEnd', 'eligible', 'progressed', 'pending', 'unknown', 'value', 'unit', 'coverageComplete']);
const AGING_FIELDS = Object.freeze(['id', 'metricType', 'windowStart', 'windowEnd', 'eligible', 'progressed', 'pending', 'stale', 'staleThresholdDays', 'value', 'unit', 'coverageComplete']);
const PRODUCT_FIELDS = Object.freeze(['id', 'metricType', 'asOf', 'windowStart', 'windowEnd', 'total', 'active', 'complete', 'incomplete', 'archived', 'missingImages', 'missingSkus', 'missingDocuments', 'missingSupply', 'value', 'unit', 'coverageComplete']);

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

/**
 * Anchor the observation window to the business data, not to the wall clock.
 *
 * Completed UTC days only: an observation never includes the day it is taken in.
 * Anchoring on the latest recorded business activity (falling back to the
 * durable store creation time) keeps the window, and therefore the source
 * revision, identical across days while the data is unchanged. Previously the
 * window ended at `dayStart(now)`, so every saved context and decision became
 * BRAIN_SOURCE_STALE at the next UTC midnight even with no business change.
 */
function observationAnchor(state, workspaceId, now) {
  const times = [];
  const record = value => { const parsed = parseTime(value); if (parsed !== null) times.push(parsed); };
  for (const row of state.supplyNetwork?.inquiries || []) {
    if (row?.workspaceId !== workspaceId) continue;
    for (const value of [row.createdAt, row.updatedAt, row.publishedAt, row.sentAt, row.share?.createdAt, row.share?.revokedAt]) record(value);
    for (const reply of Array.isArray(row.replies) ? row.replies : []) for (const value of [reply?.createdAt, reply?.updatedAt]) record(value);
  }
  for (const product of Array.isArray(state.businessLibrary?.products) ? state.businessLibrary.products : []) record(product?.updatedAt);
  record(state.meta?.createdAt);
  const latest = times.length ? Math.max(...times) : now;
  // Include the day the activity happened on, but never a day that is not yet
  // complete: the window advances once, at the following UTC midnight, and then
  // stays fixed until the business data moves again.
  return Math.min(dayStart(Math.min(latest, now)) + DAY, dayStart(now));
}

/**
 * Business metrics for one exact, already-decided observation window.
 *
 * Everything here is a pure function of the store and the window: the wall
 * clock is never consulted, so replaying the same window reproduces the same
 * bytes. That is what lets a saved reference stay verifiable after the
 * "current" window has moved on. Aging is measured at the end of the observed
 * window, not "now", for the same reason.
 */
function snapshotFor(state, workspaceId, startTime, endTime) {
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
    return created !== null && endTime - created >= STALE_INQUIRY_DAYS * DAY;
  });

  const products = Array.isArray(state.businessLibrary?.products) ? state.businessLibrary.products : [];
  const activeProducts = products.filter(product => product?.status !== 'archived');
  const archivedProducts = products.length - activeProducts.length;
  const incomplete = activeProducts.filter(product => {
    return !String(product?.description || '').trim()
      || !String(product?.category || '').trim()
      || !Array.isArray(product?.skus) || product.skus.length === 0
      || !Array.isArray(product?.images) || product.images.length === 0
      || !Array.isArray(product?.documents) || product.documents.length === 0
      || productSupplyMissing(product);
  });
  const missingImages = activeProducts.filter(product => !Array.isArray(product?.images) || product.images.length === 0).length;
  const missingSkus = activeProducts.filter(product => !Array.isArray(product?.skus) || product.skus.length === 0).length;
  const missingDocuments = activeProducts.filter(product => !Array.isArray(product?.documents) || product.documents.length === 0).length;
  const missingSupply = activeProducts.filter(productSupplyMissing).length;

  const pipeline = {
    id: 'supply-inquiry-pipeline',
    metricType: 'inquiry-pipeline-v1',
    windowStart: start,
    windowEnd: end,
    eligible: eligibleRows.length,
    progressed: progressedRows.length,
    pending: pendingRows.length,
    unknown: 0,
    value: progressedRows.length,
    unit: 'inquiries',
    coverageComplete: eligibleRows.length > 0 && pendingRows.length === 0
  };
  const aging = {
    id: 'supply-inquiry-aging',
    metricType: 'inquiry-aging-v1',
    windowStart: start,
    windowEnd: end,
    eligible: eligibleRows.length,
    progressed: progressedRows.length,
    pending: pendingRows.length,
    stale: staleRows.length,
    staleThresholdDays: STALE_INQUIRY_DAYS,
    value: staleRows.length,
    unit: 'inquiries',
    coverageComplete: eligibleRows.length > 0
  };
  const product = {
    id: 'library-product-completeness',
    metricType: 'product-completeness-v1',
    asOf: end,
    windowStart: end,
    windowEnd: end,
    total: products.length,
    active: activeProducts.length,
    complete: activeProducts.length - incomplete.length,
    incomplete: incomplete.length,
    archived: archivedProducts,
    missingImages,
    missingSkus,
    missingDocuments,
    missingSupply,
    value: incomplete.length,
    unit: 'products',
    // A point-in-time library snapshot never spans an outcome window, so it can
    // never on its own justify a "supported" outcome review.
    coverageComplete: false
  };

  return {
    refs: [
      { id: 'supply-inquiry-pipeline', values: pipeline, fields: PIPELINE_FIELDS, observedAt: iso(latestInquiryActivity(rows, endTime)) },
      { id: 'supply-inquiry-aging', values: aging, fields: AGING_FIELDS, observedAt: iso(latestInquiryActivity(rows, endTime)) },
      { id: 'library-product-completeness', values: product, fields: PRODUCT_FIELDS, observedAt: end }
    ]
  };
}

function snapshot(state, workspaceId, clock) {
  // Completed UTC days as the observation window: a constant window produces a
  // constant revision, which is what makes Brain source revalidation possible.
  const endTime = observationAnchor(state, workspaceId, clock());
  return snapshotFor(state, workspaceId, endTime - INQUIRY_WINDOW_DAYS * DAY, endTime);
}

function authorize(identity, workspaceId) {
  if (!identity?.workspaceId || identity.workspaceId !== workspaceId) fail('BRAIN_SOURCE_SCOPE_MISMATCH');
}

function makeReference(id, values, fields) {
  return {
    kind: 'metric',
    id,
    revision: digest({ source: id, values }),
    sha256: digest(values),
    fields: [...fields],
    // The reference pins the exact window its own values were taken over.
    // Without it a "re-read" could only mean "recompute against the current
    // clock", which is what made every saved decision go stale as soon as time
    // or the business data moved.
    windowStart: values.windowStart,
    windowEnd: values.windowEnd
  };
}

const POINT_IN_TIME_METRIC = 'library-product-completeness';

/**
 * Resolve the window a reference was actually taken over, and refuse anything
 * this adapter could not have emitted itself. A caller therefore cannot ask for
 * an arbitrary or not-yet-complete window to obtain different data.
 */
function referenceWindow(reference, latestCompleteDay) {
  const start = parseTime(reference?.windowStart);
  const end = parseTime(reference?.windowEnd);
  if (start === null || end === null) fail('BRAIN_SOURCE_CHANGED');
  if (reference?.id === POINT_IN_TIME_METRIC ? start !== end : end - start !== INQUIRY_WINDOW_DAYS * DAY) fail('BRAIN_SOURCE_CHANGED');
  if (start % DAY !== 0 || end % DAY !== 0 || end > latestCompleteDay || start > end) fail('BRAIN_SOURCE_CHANGED');
  return { startTime: start, endTime: end };
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

  function resolve(identity, reference) {
    authorize(identity, workspaceId);
    if (reference?.kind !== 'metric' || typeof reference?.id !== 'string') fail('BRAIN_SOURCE_CHANGED');
    const window = referenceWindow(reference, dayStart(clock()));
    const snap = snapshotFor(store.read(), workspaceId, window.startTime, window.endTime);
    const item = snap.refs.find(entry => entry.id === reference.id);
    if (!item) fail('BRAIN_SOURCE_CHANGED');
    const built = makeReference(item.id, item.values, item.fields);
    if (!same(built, reference)) fail('BRAIN_SOURCE_CHANGED');
    return { workspaceId, reference: built, observedAt: item.observedAt, validUntil: null, values: item.values };
  }

  return Object.freeze({
    async list({ identity } = {}) {
      authorize(identity, workspaceId);
      return buildSnapshot(store.read(), workspaceId, clock).map(item => item.reference);
    },

    async read({ identity, reference } = {}) {
      return safeJson(resolve(identity, reference), 32 * 1024);
    },

    current({ identity, reference, expected } = {}) {
      const row = resolve(identity, reference);
      if (!expected || !same(row, expected)) fail('BRAIN_SOURCE_CHANGED');
      return row;
    }
  });
}

/**
 * Synchronous fingerprint of the current observation set.
 *
 * Used by scheduler preconditions, which run inside a synchronous store
 * transaction and therefore cannot await an adapter. A new observation, or a
 * moved window, changes the fingerprint; re-reading the same observations on a
 * later day does not.
 */
export function businessBrainSourceFingerprint({ state, workspaceId = 'local', clock = Date.now } = {}) {
  if (!state) throw new TypeError('A store snapshot is required.');
  const refs = buildSnapshot(state, workspaceId, clock).map(item => [
    item.reference.kind, item.reference.id, item.reference.revision, item.reference.sha256,
    item.reference.windowStart ?? null, item.reference.windowEnd ?? null
  ]);
  refs.sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
  return digest(refs);
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
