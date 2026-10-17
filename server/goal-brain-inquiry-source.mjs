import { clone, digest, fail } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';

const DAY = 86_400_000;
const FIELDS = ['metricType','windowStart','windowEnd','eligible','progressed','pending','unknown','segment','baseline','uniqueCustomers'];
const PREFIX = 'inquiry-pipeline:';
const AGING_PREFIX = 'inquiry-aging:';
const AGING_FIELDS = ['metricType','windowStart','windowEnd','eligible','progressed','pending','unknown','stale','staleThresholdDays','segment'];
const STALE_DAYS = 7;
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;

function windows(clock) {
  // Hour-pinned observation windows keep list/read/current stable between calls.
  const end = Math.floor(Number(clock()) / 3_600_000) * 3_600_000;
  if (!Number.isFinite(end)) fail('BRAIN_SOURCE_CHANGED');
  const observedAt = new Date(end).toISOString();
  const currentEnd = observedAt;
  const currentStart = new Date(end - 30 * DAY).toISOString();
  const baselineEnd = currentStart;
  const baselineStart = new Date(end - 60 * DAY).toISOString();
  return { observedAt, current: { start: currentStart, end: currentEnd }, baseline: { start: baselineStart, end: baselineEnd } };
}

function sharedWithSubject(row, subject) {
  return row.share?.merchantSubject === subject;
}

function included(row, identity) {
  return row?.workspaceId === identity?.workspaceId
    && typeof identity?.subject === 'string'
    && (row.createdBy === identity.subject || sharedWithSubject(row, identity.subject));
}

function received(row) {
  if (row?.status === 'draft') return false;
  return row?.status === 'shared' || row?.status === 'replied' || row?.status === 'revoked'
    || row?.share?.status === 'active' || row?.share?.status === 'revoked';
}

function classification(row) {
  const replies = Array.isArray(row.replies) ? row.replies : [];
  if (replies.length > 0) return 'progressed';
  if (row.share?.status === 'active') return 'pending';
  if (row.share?.status === 'revoked' || row.status === 'revoked') return 'unknown';
  return 'unknown';
}

function productKey(listing) {
  const id = listing?.productRef?.productId;
  return typeof id === 'string' && VALID_ID.test(id) ? id : 'unknown';
}

function metricFor(rows, listings, segment, window) {
  const eligible = rows.filter(row => {
    const created = Date.parse(row.createdAt || '');
    return Number.isFinite(created) && created >= Date.parse(window.start) && created < Date.parse(window.end)
      && productKey(listings.get(row.listingId)) === segment;
  });
  const customers = new Set();
  let progressed = 0, pending = 0, unknown = 0;
  for (const row of eligible) {
    if (typeof row.createdBy === 'string' && row.createdBy) customers.add(row.createdBy);
    const state = classification(row);
    if (state === 'progressed') progressed++;
    else if (state === 'pending') pending++;
    else unknown++;
  }
  return { eligible: eligible.length, progressed, pending, unknown, uniqueCustomers: customers.size };
}

function segmentsFor(rows, listings, windowsFor) {
  const start = Date.parse(windowsFor.baseline.start);
  const end = Date.parse(windowsFor.current.end);
  return [...new Set(rows.filter(received).filter(row => {
    const created = Date.parse(row.createdAt || '');
    return Number.isFinite(created) && created >= start && created < end;
  }).map(row => productKey(listings.get(row.listingId))))].sort();
}

function agingFor(rows, listings, segment, window) {
  const eligible = rows.filter(row => {
    const created = Date.parse(row.createdAt || '');
    return Number.isFinite(created) && created >= Date.parse(window.start) && created < Date.parse(window.end)
      && productKey(listings.get(row.listingId)) === segment;
  });
  const progressed = eligible.filter(row => classification(row) === 'progressed').length;
  const pending = eligible.filter(row => classification(row) === 'pending').length;
  const unknown = eligible.filter(row => classification(row) === 'unknown').length;
  const staleCutoff = Date.parse(window.end) - STALE_DAYS * DAY;
  const stale = eligible.filter(row => classification(row) === 'pending' && Date.parse(row.createdAt || '') <= staleCutoff).length;
  return { eligible: eligible.length, progressed, pending, unknown, stale, staleThresholdDays: STALE_DAYS };
}

function valuesFor(rows, listings, segment, windowsFor) {
  const current = metricFor(rows, listings, segment, windowsFor.current);
  const baselineRaw = metricFor(rows, listings, segment, windowsFor.baseline);
  const baseline = baselineRaw.eligible > 0 ? baselineRaw : null;
  return {
    metricType: 'inquiry-pipeline-v1',
    windowStart: windowsFor.current.start, windowEnd: windowsFor.current.end,
    eligible: current.eligible, progressed: current.progressed, pending: current.pending, unknown: current.unknown,
    segment: { productId: segment, market: 'unknown', channel: 'supply-network' },
    baseline: baseline ? {
      windowStart: windowsFor.baseline.start, windowEnd: windowsFor.baseline.end,
      eligible: baseline.eligible, progressed: baseline.progressed, pending: baseline.pending, unknown: baseline.unknown,
    } : null,
    uniqueCustomers: current.uniqueCustomers,
  };
}

function snapshot(store, identity, clock) {
  const state = store.read(), db = state?.supplyNetwork;
  if (!db) return { state, rows: [], listings: new Map(), refs: [] };
  if (db.workspaceId !== identity.workspaceId) fail('BRAIN_SOURCE_SCOPE_MISMATCH');
  const rows = (Array.isArray(db.inquiries) ? db.inquiries : []).filter(row => included(row, identity) && received(row));
  const listings = new Map((Array.isArray(db.listings) ? db.listings : []).map(row => [row.id, row]));
  const windowsFor = windows(clock);
  const segments = segmentsFor(rows, listings, windowsFor);
  const revision = String(state.meta?.sequence ?? 0);
  const refs = [];
  for (const segment of segments) {
    const values = valuesFor(rows, listings, segment, windowsFor);
    refs.push({ kind: 'metric', id: PREFIX + segment, revision, sha256: digest(values), fields: clone(FIELDS) });
    const aging = agingFor(rows, listings, segment, windowsFor.current);
    if (aging.stale > 0) {
      const agingValues = {
        metricType: 'inquiry-aging-v1',
        windowStart: windowsFor.current.start,
        windowEnd: windowsFor.current.end,
        eligible: aging.eligible,
        progressed: aging.progressed,
        pending: aging.pending,
        unknown: aging.unknown,
        stale: aging.stale,
        staleThresholdDays: aging.staleThresholdDays,
        segment: { productId: segment, market: 'unknown', channel: 'supply-network' },
      };
      refs.push({ kind: 'metric', id: AGING_PREFIX + segment, revision, sha256: digest(agingValues), fields: clone(AGING_FIELDS) });
    }
  }
  return { state, rows, listings, windowsFor, refs };
}

function find(snap, reference) {
  if (reference?.kind !== 'metric' || typeof reference.id !== 'string') fail('BRAIN_SOURCE_NOT_SELECTED');
  const aging = reference.id.startsWith(AGING_PREFIX);
  const prefix = aging ? AGING_PREFIX : PREFIX;
  if (!reference.id.startsWith(prefix)) fail('BRAIN_SOURCE_NOT_SELECTED');
  const segment = reference.id.slice(prefix.length);
  if (!segment || !VALID_ID.test(segment)) fail('BRAIN_SOURCE_NOT_SELECTED');
  const ref = snap.refs.find(item => item.id === reference.id);
  if (!ref) fail('BRAIN_SOURCE_CHANGED');
  const values = aging
    ? (() => {
      const metric = agingFor(snap.rows, snap.listings, segment, snap.windowsFor.current);
      return {
        metricType: 'inquiry-aging-v1',
        windowStart: snap.windowsFor.current.start,
        windowEnd: snap.windowsFor.current.end,
        eligible: metric.eligible,
        progressed: metric.progressed,
        pending: metric.pending,
        unknown: metric.unknown,
        stale: metric.stale,
        staleThresholdDays: metric.staleThresholdDays,
        segment: { productId: segment, market: 'unknown', channel: 'supply-network' },
      };
    })()
    : valuesFor(snap.rows, snap.listings, segment, snap.windowsFor);
  if (reference.revision !== ref.revision || reference.sha256 !== ref.sha256 || JSON.stringify(reference.fields) !== JSON.stringify(ref.fields)) fail('BRAIN_SOURCE_CHANGED');
  return { workspaceId: snap.state?.supplyNetwork?.workspaceId, reference: ref, observedAt: snap.windowsFor.observedAt, validUntil: null, values };
}

export function createSupplyInquiryBrainSourceAdapter({ store, clock = Date.now } = {}) {
  if (!store?.read || typeof clock !== 'function') throw new TypeError('The original Workspace store and a clock are required.');
  async function list({ identity } = {}) { return snapshot(store, identity, clock).refs; }
  async function read({ identity, reference, signal } = {}) {
    signal?.throwIfAborted();
    const row = find(snapshot(store, identity, clock), reference);
    signal?.throwIfAborted();
    return row;
  }
  function current({ identity, reference, expected } = {}) {
    const row = find(snapshot(store, identity, clock), reference);
    if (!expected || expected.workspaceId !== identity.workspaceId || JSON.stringify(expected.reference) !== JSON.stringify(row.reference)) fail('BRAIN_SOURCE_CHANGED');
    return row;
  }
  return Object.freeze({ list, read, current });
}