// Product Library domain: a shared product room over one Medusa product and
// its *approved* Product Context. Pages, revisions, comments, approvals and
// citations live in the harness store; Medusa remains the fact authority.
//
// The domain is deliberately source-injected: it has no credentials, no HTTP
// and no model access of its own. The plugin wires a reviewed Medusa source;
// tests wire a synthetic one.
//
// ChatGPT-Space parity kept in scope: one product room = one shared space,
// versioned pages, citations back to live sources, comment threads and a
// human approval state. Deliberately out of scope for this slice: uploads,
// slides, tasks/automations, real-time presence and an agent write-back to
// Medusa (the product context review path stays the only writer).
import { createHash, randomUUID } from 'node:crypto';
import { HarnessError } from '../../../packages/harness-contracts/src/index.mjs';

export const LIBRARY_KEY = 'harnessProductLibrary';
export const LIBRARY_VERSION = 1;
export const PRODUCT_ID = /^prod_[A-Za-z0-9_-]{1,123}$/u;
export const SOURCE_HASH = /^(?:[a-f0-9]{64}|rev:[a-f0-9]{32}:[a-f0-9]{64})$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const LIMITS = Object.freeze({
  rooms: 200, pages: 100, versions: 50, comments: 200, citations: 50, documents: 50,
  receipts: 5000, title: 200, body: 65536, comment: 4000, label: 240,
});
/** JSON uploads must fit the kernel's 1 MiB request body; 512 KiB leaves room for base64 + metadata. */
export const DOCUMENT_MAX_BYTES = 512 * 1024;
export const DOCUMENT_KINDS = Object.freeze(['certificate', 'test_report', 'spec_sheet', 'case_study', 'other']);
const DOCUMENT_MIME = /^[a-z0-9][a-z0-9.+-]{0,99}\/[a-z0-9][a-z0-9.+-]{0,99}$/u;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;


export class ProductLibraryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ProductLibraryError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new ProductLibraryError(status, code, message); };

const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

function text(value, maximum, { empty = false } = {}) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximum
    || !empty && !value.trim() || CONTROL.test(value))
    fail(400, 'PRODUCT_LIBRARY_INPUT', 'Text is empty, unsafe or exceeds its byte limit.');
  return value;
}
function array(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) fail(400, 'PRODUCT_LIBRARY_INPUT', 'Use a bounded JSON array.');
  return value;
}
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail(400, 'PRODUCT_LIBRARY_INPUT', 'Use an exact UUID.'); return value; }
function productId(value) { if (typeof value !== 'string' || !PRODUCT_ID.test(value)) fail(400, 'PRODUCT_LIBRARY_INPUT', 'Use an exact Medusa product id.'); return value; }
function integer(value, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(400, 'PRODUCT_LIBRARY_INPUT', 'Use a bounded integer.');
  return value;
}
function stamp(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(400, 'PRODUCT_LIBRARY_INPUT', 'Use an exact UTC timestamp.'); return value; }

const defaultState = () => ({ version: LIBRARY_VERSION, rooms: [], receipts: [] });

function namespace(state) {
  if (!isPlain(state)) fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'The harness store is not available.');
  if (state[LIBRARY_KEY] === undefined) return defaultState();
  return state[LIBRARY_KEY];
}

/** Fail closed on damaged or oversized library state; never silently reset it. */
export function validateLibraryState(state) {
  const data = namespace(state);
  if (!isPlain(data) || data.version !== LIBRARY_VERSION || !Array.isArray(data.rooms) || !Array.isArray(data.receipts)
    || data.rooms.length > LIMITS.rooms || data.receipts.length > LIMITS.receipts
    || Object.keys(data).some(key => !['version', 'rooms', 'receipts'].includes(key)))
    fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'Invalid Product Library storage.');
  const ids = new Set(), requestKeys = new Set();
  for (const room of data.rooms) {
    if (!isPlain(room) || !PRODUCT_ID.test(room.productId) || ids.has(room.productId) || !isPlain(room.pin)
      || !Array.isArray(room.pages) || room.pages.length > LIMITS.pages
      || !Number.isSafeInteger(room.roomRevision) || room.roomRevision < 1)
      fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'Invalid Product Library room.');
    ids.add(room.productId);
    if (typeof room.pin.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(room.pin.hash)
      || digest({ product: room.pin.product, context: room.pin.context }) !== room.pin.hash)
      fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'Product Library source pin integrity failure.');
    stamp(room.createdAt); stamp(room.updatedAt); stamp(room.pin.pinnedAt);
    const pageIds = new Set();
    for (const page of room.pages) {
      if (!isPlain(page) || !UUID.test(page.id) || pageIds.has(page.id) || !Array.isArray(page.versions)
        || page.versions.length < 1 || page.versions.length > LIMITS.versions || !Array.isArray(page.comments)
        || page.comments.length > LIMITS.comments || !Number.isSafeInteger(page.revision) || page.revision < 1)
        fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'Invalid Product Library page.');
      pageIds.add(page.id);
      if (!['draft', 'approved'].includes(page.status)) fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'Invalid page status.');
      for (const [index, version] of page.versions.entries()) {
        if (!isPlain(version) || version.version !== index + 1
          || version.sha256 !== digest({ title: version.title, body: version.body, citations: version.citations })
          || !Array.isArray(version.citations) || version.citations.length > LIMITS.citations)
          fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'Page version integrity failure.');
        text(version.title, LIMITS.title); text(version.body, LIMITS.body, { empty: true }); stamp(version.createdAt);
      }
      for (const comment of page.comments) {
        if (!isPlain(comment) || !UUID.test(comment.id) || !Number.isSafeInteger(comment.version)) fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'Invalid comment.');
        text(comment.body, LIMITS.comment); stamp(comment.createdAt);
      }
    }
    if (!Array.isArray(room.documents) || room.documents.length > LIMITS.documents)
      fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'Invalid Product Library documents.');
    const documentIds = new Set(), artifactIds = new Set();
    for (const document of room.documents) {
      if (!isPlain(document) || !UUID.test(document.id) || documentIds.has(document.id)
        || !UUID.test(document.artifactId) || artifactIds.has(document.artifactId)
        || !Number.isSafeInteger(document.size) || document.size < 1 || document.size > DOCUMENT_MAX_BYTES
        || !/^[a-f0-9]{64}$/u.test(document.sha256 ?? '') || !DOCUMENT_KINDS.includes(document.kind)
        || !DOCUMENT_MIME.test(document.mimeType ?? '') || !Number.isSafeInteger(document.revision) || document.revision < 1)
        fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'Invalid Product Library document.');
      documentIds.add(document.id); artifactIds.add(document.artifactId);
      text(document.filename, 255); text(document.label, LIMITS.label); stamp(document.createdAt);
      if (document.evidenceId !== null && typeof document.evidenceId !== 'string') fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'Invalid document evidence link.');
    }
  }
  for (const row of data.receipts) {
    if (!isPlain(row) || typeof row.workspaceId !== 'string' || typeof row.requestId !== 'string' || !UUID.test(row.requestId)
      || typeof row.subject !== 'string' || typeof row.fingerprint !== 'string'
      || !/^[a-f0-9]{64}$/u.test(row.fingerprint) || !isPlain(row.result))
      fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'Invalid Product Library receipt.');
    const key = JSON.stringify([row.workspaceId, row.subject, row.requestId]);
    if (requestKeys.has(key)) fail(500, 'HARNESS_PRODUCT_LIBRARY_INVALID', 'Duplicate Product Library receipt.');
    requestKeys.add(key);
  }
  return true;
}

const CONTEXT_FIELDS = Object.freeze({
  readiness_score: 'readinessScore',
  buyer_profile: 'buyerProfile',
  target_markets: 'targetMarkets',
  use_cases: 'useCases',
  selling_points: 'sellingPoints',
  commercial_policy: 'commercialPolicy',
  missing_evidence: 'missingEvidence',
  agent_summary: 'agentSummary',
});
const PRODUCT_FIELDS = Object.freeze(['title', 'subtitle', 'handle', 'description', 'status', 'thumbnail']);

function strings(value, maximum, count = 50) {
  return array(value ?? [], count).map(item => text(item, maximum));
}
function optionalText(value, maximum) {
  if (value === null || value === undefined) return null;
  return text(value, maximum);
}

/** Map one `/agent/product-contexts` row into the pinned library projection. */
export function pinFromRow(row, at = new Date().toISOString()) {
  const product = row?.product, context = row?.context;
  if (!isPlain(product) || !isPlain(context) || !PRODUCT_ID.test(product.id ?? '')
    || context.product_id !== product.id || context.status !== 'approved'
    || !Number.isSafeInteger(context.review_version) || context.review_version < 1
    || !SOURCE_HASH.test(context.source_hash ?? ''))
    fail(502, 'PRODUCT_LIBRARY_SOURCE_INVALID', 'The reviewed Medusa source returned an invalid product context.');
  const productPin = {
    id: product.id,
    title: text(product.title ?? '', 2000),
    subtitle: optionalText(product.subtitle, 500),
    handle: optionalText(product.handle, 200),
    description: optionalText(product.description, 8000),
    status: optionalText(product.status, 80),
    thumbnail: optionalText(product.thumbnail, 2000),
    variants: array(product.variants ?? [], 200).map(variant => ({
      id: text(variant?.id ?? '', 120), title: optionalText(variant?.title, 200), sku: optionalText(variant?.sku, 200),
    })),
  };
  const contextPin = {
    reviewVersion: context.review_version,
    sourceHash: context.source_hash,
    readinessScore: Number(context.readiness_score),
    buyerProfile: optionalText(context.buyer_profile, 2000),
    targetMarkets: strings(context.target_markets, 120),
    useCases: strings(context.use_cases, 160),
    sellingPoints: strings(context.selling_points, 500),
    evidence: array(context.evidence ?? [], 100).map(item => ({
      id: text(item?.id ?? '', 120), label: text(item?.label ?? '', 200), type: text(item?.type ?? '', 40),
      status: text(item?.status ?? '', 20), sha256: item?.sha256 ?? null, reviewedAt: item?.reviewed_at ?? null,
    })),
    commercialPolicy: context.commercial_policy == null ? null : context.commercial_policy,
    missingEvidence: strings(context.missing_evidence, 240),
    agentSummary: optionalText(context.agent_summary, 5000),
    updatedAt: typeof context.updated_at === 'string' ? context.updated_at : null,
  };
  if (!Number.isFinite(contextPin.readinessScore) || contextPin.readinessScore < 0 || contextPin.readinessScore > 100)
    fail(502, 'PRODUCT_LIBRARY_SOURCE_INVALID', 'The reviewed Medusa source returned an invalid readiness score.');
  return { product: productPin, context: contextPin, hash: digest({ product: productPin, context: contextPin }), pinnedAt: at };
}

function contextValue(pin, field) {
  const key = CONTEXT_FIELDS[field];
  return key ? pin.context[key] : undefined;
}
function citationValue(pin, citation) {
  if (citation.source === 'product') return pin.product[citation.field];
  if (citation.source === 'context') return contextValue(pin, citation.field);
  if (citation.source === 'evidence') return pin.context.evidence.find(item => item.id === citation.field);
  return undefined;
}
function preview(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.slice(0, 5).map(item => typeof item === 'string' ? item : canonical(item)).join(' · ').slice(0, 240);
  if (typeof value === 'object') return canonical(value).slice(0, 240);
  return String(value).slice(0, 240);
}

/** Resolve one citation against the current pin; saved hashes detect drift. */
export function resolveCitation(pin, citation) {
  const value = citationValue(pin, citation);
  if (value === undefined) return { ...citation, status: 'missing', preview: null };
  const current = digest(value);
  return { source: citation.source, field: citation.field, label: citation.label, status: current === citation.valueHash ? 'current' : 'stale', preview: preview(value) };
}

function normalizeCitations(pin, input) {
  array(input ?? [], LIMITS.citations);
  const seen = new Set();
  return (input ?? []).map(raw => {
    if (!isPlain(raw) || Object.keys(raw).some(key => !['source', 'field', 'label'].includes(key)))
      fail(400, 'PRODUCT_LIBRARY_INPUT', 'Citations use source, field and label only.');
    if (!['product', 'context', 'evidence'].includes(raw.source)) fail(400, 'PRODUCT_LIBRARY_INPUT', 'Unknown citation source.');
    const field = text(raw.field, 120);
    const key = `${raw.source}:${field}`;
    if (seen.has(key)) fail(400, 'PRODUCT_LIBRARY_INPUT', 'Duplicate citation.');
    seen.add(key);
    const value = citationValue(pin, { source: raw.source, field });
    if (value === undefined) fail(400, 'PRODUCT_LIBRARY_CITATION_UNKNOWN', `Citation ${key} is not present on the pinned source.`);
    return { source: raw.source, field, label: raw.label === undefined ? defaultLabel(pin, raw.source, field) : text(raw.label, LIMITS.label), valueHash: digest(value) };
  });
}
function defaultLabel(pin, source, field) {
  if (source === 'product') return `商品 · ${field}`;
  if (source === 'evidence') return `证据 · ${pin.context.evidence.find(item => item.id === field)?.label ?? field}`;
  return `产品上下文 · ${field}`;
}

function diffPins(before, after) {
  const changed = [];
  for (const field of PRODUCT_FIELDS) if (canonical(before.product[field]) !== canonical(after.product[field])) changed.push(`product.${field}`);
  if (before.product.variants.length !== after.product.variants.length) changed.push('product.variants');
  for (const field of Object.keys(CONTEXT_FIELDS)) {
    const key = CONTEXT_FIELDS[field];
    if (canonical(before.context[key]) !== canonical(after.context[key])) changed.push(`context.${field}`);
  }
  if (before.context.reviewVersion !== after.context.reviewVersion) changed.push('context.review_version');
  if (before.context.sourceHash !== after.context.sourceHash) changed.push('context.source_hash');
  return [...new Set(changed)];
}

function actorOf(context, workspaceId) {
  const actor = context?.actor;
  if (!isPlain(actor) || typeof actor.subject !== 'string' || !actor.subject
    || !['admin', 'operator', 'viewer'].includes(actor.role))
    fail(401, 'PRODUCT_LIBRARY_SESSION_REQUIRED', 'A current harness actor is required.');
  if ((actor.workspaceId ?? 'local') !== workspaceId)
    fail(403, 'PRODUCT_LIBRARY_FORBIDDEN', 'This Product Library belongs to another workspace.');
  return actor;
}
const canWrite = actor => actor.role === 'admin' || actor.role === 'operator';

function pageView(page, pin) {
  const current = page.versions.at(-1);
  return {
    id: page.id, status: page.status, revision: page.revision, version: current.version,
    title: current.title, body: current.body,
    citations: current.citations.map(citation => resolveCitation(pin, citation)),
    createdAt: page.createdAt, updatedAt: page.updatedAt,
    approvedAt: page.approvedAt ?? null, approvedBy: page.approvedBy ?? null,
    history: page.versions.map(({ body, citations, ...metadata }) => metadata),
    comments: structuredClone(page.comments),
  };
}

function roomView(room) {
  return {
    productId: room.productId,
    pin: structuredClone(room.pin),
    pages: room.pages.map(page => pageView(page, room.pin)),
    documents: room.documents.map(document => ({
      ...structuredClone(document),
      downloadPath: `/api/product-library/products/${room.productId}/documents/${document.id}`,
    })),
    counts: {
      pages: room.pages.length,
      approved: room.pages.filter(page => page.status === 'approved').length,
      comments: room.pages.reduce((total, page) => total + page.comments.length, 0),
      documents: room.documents.length,
    },
    createdAt: room.createdAt, updatedAt: room.updatedAt,
  };
}

/**
 * Create the domain boundary.
 *
 * @param {object} options
 * @param {{read(): object, update(fn: Function): Promise<any>}} options.storage
 * @param {object} options.source reviewed source: `{configured, kind, list, read}`.
 * @param {() => number} [options.clock]
 * @param {string} [options.workspaceId]
 */
export function createProductLibraryService({ storage, source, artifacts, clock = Date.now, workspaceId = 'local' } = {}) {
  if (!storage || typeof storage.read !== 'function' || typeof storage.update !== 'function')
    throw new TypeError('Product Library requires the harness storage seam.');
  if (!source || typeof source.read !== 'function' || typeof source.list !== 'function')
    throw new TypeError('Product Library requires a reviewed product source.');
  if (!artifacts || typeof artifacts.create !== 'function' || typeof artifacts.download !== 'function')
    throw new TypeError('Product Library requires the harness artifacts seam.');
  if (typeof workspaceId !== 'string' || !workspaceId) throw new TypeError('Product Library requires an exact workspace id.');
  const at = () => new Date(clock()).toISOString();

  function state() {
    const current = storage.read() ?? {};
    validateLibraryState(current);
    return namespace(current);
  }
  function roomOf(data, id) {
    const room = data.rooms.find(item => item.productId === id);
    if (!room) fail(404, 'PRODUCT_LIBRARY_ROOM_NOT_FOUND', 'Open this product before editing its library.');
    return room;
  }
  function pageOf(room, id) {
    const page = room.pages.find(item => item.id === id);
    if (!page) fail(404, 'PRODUCT_LIBRARY_PAGE_NOT_FOUND', 'This Product Library page does not exist.');
    return page;
  }
  function receiptOf(data, actor, requestId, fingerprint) {
    const prior = data.receipts.find(row => row.workspaceId === workspaceId && row.subject === actor.subject && row.requestId === requestId);
    if (!prior) return null;
    if (prior.fingerprint !== fingerprint) fail(409, 'PRODUCT_LIBRARY_IDEMPOTENCY_CONFLICT', 'This requestId already belongs to a different command.');
    return prior;
  }
  function remember(data, actor, requestId, fingerprint, operation, result) {
    if (data.receipts.length >= LIMITS.receipts) fail(409, 'PRODUCT_LIBRARY_LIMIT', 'The bounded operation receipt list is full.');
    const row = { workspaceId, subject: actor.subject, requestId, fingerprint, operation, at: at(), result: structuredClone(result) };
    data.receipts.push(row);
    return row;
  }
  function fingerprintOf(operation, product, page, body) { return digest({ workspaceId, operation, product, page, body }); }
  function assertWrite(actor) { if (!canWrite(actor)) fail(403, 'PRODUCT_LIBRARY_FORBIDDEN', 'Viewer access cannot edit this Product Library.'); }

  async function sourceStatus() {
    return { configured: source.configured === true, kind: source.kind ?? 'unconfigured' };
  }

  return Object.freeze({
    status() {
      const data = state();
      return {
        configured: source.configured === true,
        source: source.kind ?? 'unconfigured',
        workspaceId,
        rooms: data.rooms.length,
        pages: data.rooms.reduce((total, room) => total + room.pages.length, 0),
        approvedPages: data.rooms.reduce((total, room) => total + room.pages.filter(page => page.status === 'approved').length, 0),
      };
    },

    list(context, query = {}) {
      const actor = actorOf(context, workspaceId);
      const q = typeof query.q === 'string' ? query.q.slice(0, 200) : '';
      const limit = query.limit === undefined ? 20 : integer(Number(query.limit), { maximum: 50 });
      const data = state(), byId = new Map(data.rooms.map(room => [room.productId, room]));
      const stored = data.rooms.map(room => ({
        productId: room.productId, title: room.pin.product.title, handle: room.pin.product.handle,
        status: room.pin.product.status, thumbnail: room.pin.product.thumbnail,
        variantCount: room.pin.product.variants.length, readinessScore: room.pin.context.readinessScore,
        reviewVersion: room.pin.context.reviewVersion, inLibrary: true, pageCount: room.pages.length,
        approvedPages: room.pages.filter(page => page.status === 'approved').length, documentCount: room.documents.length,
      })).filter(row => !q || row.title.toLocaleLowerCase().includes(q.toLocaleLowerCase()));
      const finish = (items, live, warning) => ({ source: { configured: source.configured === true, kind: source.kind ?? 'unconfigured', live, ...(warning ? { warning } : {}) }, items: items.slice(0, limit), total: items.length });
      if (!source.configured) return finish(stored, false, 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED');
      return source.list({ q, limit: 100 }, actor).then(payload => {
        const remote = array(payload?.items ?? [], 100).map(row => {
          const pin = pinFromRow(row, at());
          const room = byId.get(pin.product.id);
          return {
            productId: pin.product.id, title: pin.product.title, handle: pin.product.handle,
            status: pin.product.status, thumbnail: pin.product.thumbnail,
            variantCount: pin.product.variants.length, readinessScore: pin.context.readinessScore,
            reviewVersion: pin.context.reviewVersion, inLibrary: Boolean(room),
            pageCount: room?.pages.length ?? 0, approvedPages: room?.pages.filter(page => page.status === 'approved').length ?? 0,
            documentCount: room?.documents.length ?? 0,
          };
        });
        return finish(remote, true, null);
      }).catch(error => {
        if (error instanceof ProductLibraryError
          && ['PRODUCT_LIBRARY_SOURCE_UNAVAILABLE', 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED'].includes(error.code))
          return finish(stored, false, error.code);
        throw error;
      });
    },

    read(context, productIdInput) {
      const actor = actorOf(context, workspaceId);
      const id = productId(productIdInput);
      const data = state(), room = roomOf(data, id);
      return Promise.resolve(sourceStatus()).then(sourceInfo => ({
        ...roomView(room), canEdit: canWrite(actor), canApprove: actor.role === 'admin',
        source: { ...sourceInfo, live: false, warning: source.configured ? null : 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED' },
      }));
    },

    async open(context, productIdInput, body = {}) {
      const actor = actorOf(context, workspaceId);
      assertWrite(actor);
      const id = productId(productIdInput);
      const requestId = uuid(body.requestId);
      const fingerprint = fingerprintOf('open', id, null, {});
      const existing = receiptOf(state(), actor, requestId, fingerprint);
      if (existing) return { status: 200, body: { ...structuredClone(existing.result), replayed: true } };
      const current = state(), priorRoom = current.rooms.find(room => room.productId === id);
      if (priorRoom) {
        const result = { productId: id, created: false, revision: priorRoom.roomRevision ?? 1 };
        return { status: 200, body: { ...result, replayed: false } };
      }
      if (!source.configured) fail(503, 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED', 'No reviewed Medusa product source is configured.');
      const row = await source.read(id, actor);
      if (!row) fail(404, 'PRODUCT_LIBRARY_PRODUCT_NOT_APPROVED', 'This product has no approved Product Context.');
      const result = await storage.update(next => {
        validateLibraryState(next);
        const data = next[LIBRARY_KEY] ?? (next[LIBRARY_KEY] = defaultState());
        if (data.rooms.length >= LIMITS.rooms) fail(409, 'PRODUCT_LIBRARY_LIMIT', 'The bounded Product Library room list is full.');
        const old = data.rooms.find(room => room.productId === id);
        if (old) return { productId: id, created: false, revision: old.roomRevision ?? 1, replayed: false };
        const pin = pinFromRow(row, at());
        const now = at();
        const room = { productId: id, pin, pages: [], documents: [], roomRevision: 1, createdAt: now, updatedAt: now };
        data.rooms.push(room);
        remember(data, actor, requestId, fingerprint, 'open', { productId: id, created: true, revision: 1 });
        return { productId: id, created: true, revision: 1, replayed: false };
      });
      return { status: result.created ? 201 : 200, body: result };
    },

    async sync(context, productIdInput, body = {}) {
      const actor = actorOf(context, workspaceId);
      assertWrite(actor);
      const id = productId(productIdInput);
      const requestId = uuid(body.requestId);
      const fingerprint = fingerprintOf('sync', id, null, {});
      const existing = receiptOf(state(), actor, requestId, fingerprint);
      if (existing) return { status: 200, body: { ...structuredClone(existing.result), replayed: true } };
      if (!source.configured) fail(503, 'PRODUCT_LIBRARY_SOURCE_UNCONFIGURED', 'No reviewed Medusa product source is configured.');
      const room = roomOf(state(), id);
      const row = await source.read(id, actor);
      if (!row) fail(409, 'PRODUCT_LIBRARY_PRODUCT_NOT_APPROVED', 'The product context is no longer approved; the previous pin is retained.');
      const nextPin = pinFromRow(row, at());
      if (nextPin.hash === room.pin.hash) return { status: 200, body: { productId: id, changed: false, changedFields: [], replayed: false } };
      const changedFields = diffPins(room.pin, nextPin);
      const result = await storage.update(next => {
        validateLibraryState(next);
        const data = next[LIBRARY_KEY] ?? (next[LIBRARY_KEY] = defaultState());
        const live = roomOf(data, id);
        const stalePages = live.pages.filter(page => page.versions.at(-1).citations.some(citation => {
          const before = citationValue(room.pin, citation), after = citationValue(nextPin, citation);
          return before === undefined || after === undefined || digest(before) !== digest(after);
        })).map(page => page.id);
        live.pin = nextPin;
        live.roomRevision += 1;
        live.updatedAt = at();
        const summary = { productId: id, changed: true, changedFields, stalePages, revision: live.roomRevision };
        remember(data, actor, requestId, fingerprint, 'sync', summary);
        return summary;
      });
      return { status: 200, body: { ...result, replayed: false } };
    },

    async createPage(context, productIdInput, body = {}) {
      const actor = actorOf(context, workspaceId);
      assertWrite(actor);
      const id = productId(productIdInput);
      const requestId = uuid(body.requestId);
      const title = text(body.title, LIMITS.title), content = text(body.body ?? '', LIMITS.body, { empty: true });
      const fingerprint = fingerprintOf('createPage', id, null, { title, body: content, citations: body.citations ?? [] });
      const existing = receiptOf(state(), actor, requestId, fingerprint);
      if (existing) return { status: 200, body: { ...structuredClone(existing.result), replayed: true } };
      const room = roomOf(state(), id);
      const citations = normalizeCitations(room.pin, body.citations);
      const result = await storage.update(next => {
        validateLibraryState(next);
        const data = next[LIBRARY_KEY] ?? (next[LIBRARY_KEY] = defaultState());
        const live = roomOf(data, id);
        if (live.pages.length >= LIMITS.pages) fail(409, 'PRODUCT_LIBRARY_LIMIT', 'The bounded page list is full.');
        const now = at(), version = { version: 1, title, body: content, citations, sha256: digest({ title, body: content, citations }), createdAt: now, createdBy: actor.subject };
        const page = { id: randomUUID(), status: 'draft', revision: 1, versions: [version], comments: [], createdAt: now, updatedAt: now, approvedAt: null, approvedBy: null };
        live.pages.push(page); live.updatedAt = now;
        const summary = { productId: id, pageId: page.id, revision: 1, version: 1, status: 'draft' };
        remember(data, actor, requestId, fingerprint, 'createPage', summary);
        return summary;
      });
      return { status: 201, body: { ...result, replayed: false } };
    },

    async savePage(context, productIdInput, pageIdInput, body = {}) {
      const actor = actorOf(context, workspaceId);
      assertWrite(actor);
      const id = productId(productIdInput), pageId = uuid(pageIdInput);
      const requestId = uuid(body.requestId);
      const expectedRevision = integer(body.expectedRevision);
      const title = text(body.title, LIMITS.title), content = text(body.body ?? '', LIMITS.body, { empty: true });
      const fingerprint = fingerprintOf('savePage', id, pageId, { expectedRevision, title, body: content, citations: body.citations ?? [] });
      const existing = receiptOf(state(), actor, requestId, fingerprint);
      if (existing) return { status: 200, body: { ...structuredClone(existing.result), replayed: true } };
      const room = roomOf(state(), id), page = pageOf(room, pageId);
      const citations = normalizeCitations(room.pin, body.citations ?? page.versions.at(-1).citations);
      const result = await storage.update(next => {
        validateLibraryState(next);
        const data = next[LIBRARY_KEY] ?? (next[LIBRARY_KEY] = defaultState());
        const live = roomOf(data, id), target = pageOf(live, pageId);
        if (target.revision !== expectedRevision) fail(409, 'PRODUCT_LIBRARY_REVISION_CONFLICT', 'This page changed. Reload before saving.');
        if (target.versions.length >= LIMITS.versions) fail(409, 'PRODUCT_LIBRARY_HISTORY_LIMIT', 'This page has reached its version limit.');
        const now = at(), wasApproved = target.status === 'approved';
        const version = { version: target.versions.length + 1, title, body: content, citations, sha256: digest({ title, body: content, citations }), createdAt: now, createdBy: actor.subject };
        target.versions.push(version); target.revision += 1; target.updatedAt = now;
        if (wasApproved) { target.status = 'draft'; target.approvedAt = null; target.approvedBy = null; }
        live.updatedAt = now;
        const summary = { productId: id, pageId, revision: target.revision, version: version.version, status: target.status, approvalWithdrawn: wasApproved };
        remember(data, actor, requestId, fingerprint, 'savePage', summary);
        return summary;
      });
      return { status: 200, body: { ...result, replayed: false } };
    },

    async comment(context, productIdInput, pageIdInput, body = {}) {
      const actor = actorOf(context, workspaceId);
      const id = productId(productIdInput), pageId = uuid(pageIdInput);
      const requestId = uuid(body.requestId);
      const expectedRevision = integer(body.expectedRevision);
      const version = integer(body.version, { maximum: LIMITS.versions });
      const content = text(body.body, LIMITS.comment);
      const fingerprint = fingerprintOf('comment', id, pageId, { expectedRevision, version, body: content });
      const existing = receiptOf(state(), actor, requestId, fingerprint);
      if (existing) return { status: 200, body: { ...structuredClone(existing.result), replayed: true } };
      const result = await storage.update(next => {
        validateLibraryState(next);
        const data = next[LIBRARY_KEY] ?? (next[LIBRARY_KEY] = defaultState());
        const live = roomOf(data, id), target = pageOf(live, pageId);
        if (target.revision !== expectedRevision) fail(409, 'PRODUCT_LIBRARY_REVISION_CONFLICT', 'This page changed. Reload before commenting.');
        if (version > target.versions.length) fail(409, 'PRODUCT_LIBRARY_REVISION_CONFLICT', 'The cited page version does not exist.');
        if (target.comments.length >= LIMITS.comments) fail(409, 'PRODUCT_LIBRARY_LIMIT', 'This page has reached its comment limit.');
        const now = at();
        target.comments.push({ id: randomUUID(), version, body: content, createdBy: actor.subject, createdAt: now });
        target.revision += 1; target.updatedAt = now; live.updatedAt = now;
        const summary = { productId: id, pageId, revision: target.revision, comments: target.comments.length };
        remember(data, actor, requestId, fingerprint, 'comment', summary);
        return summary;
      });
      return { status: 201, body: { ...result, replayed: false } };
    },

    async attachDocument(context, productIdInput, body = {}) {
      const actor = actorOf(context, workspaceId);
      assertWrite(actor);
      const id = productId(productIdInput);
      const requestId = uuid(body.requestId);
      const filename = text(body.filename, 255);
      const label = body.label === undefined ? filename : text(body.label, LIMITS.label);
      const kind = body.kind === undefined ? 'other' : body.kind;
      if (!DOCUMENT_KINDS.includes(kind)) fail(400, 'PRODUCT_LIBRARY_INPUT', `Use a document kind: ${DOCUMENT_KINDS.join(', ')}.`);
      let mimeType = null;
      if (body.mimeType !== undefined) {
        mimeType = text(body.mimeType, 100);
        if (!DOCUMENT_MIME.test(mimeType)) fail(400, 'PRODUCT_LIBRARY_INPUT', 'mimeType must be a lowercase media type.');
      }
      if (typeof body.base64 !== 'string' || body.base64.length % 4 !== 0 || !BASE64.test(body.base64))
        fail(400, 'PRODUCT_LIBRARY_INPUT', 'base64 must be canonical padded base64.');
      if (body.base64.length > Math.ceil(DOCUMENT_MAX_BYTES / 3) * 4)
        fail(413, 'PRODUCT_LIBRARY_DOCUMENT_TOO_LARGE', `Documents are limited to ${DOCUMENT_MAX_BYTES} bytes.`);
      const bytes = Buffer.from(body.base64, 'base64');
      if (bytes.length < 1 || bytes.length > DOCUMENT_MAX_BYTES || bytes.toString('base64') !== body.base64)
        fail(413, 'PRODUCT_LIBRARY_DOCUMENT_TOO_LARGE', `Documents are limited to ${DOCUMENT_MAX_BYTES} bytes and must use canonical base64.`);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      let evidenceId = null;
      if (body.evidenceId !== undefined && body.evidenceId !== null) evidenceId = text(body.evidenceId, 120);
      const fingerprint = digest({ operation: 'attachDocument', product: id, filename, label, kind, mimeType, sha256, evidenceId });
      const existing = receiptOf(state(), actor, requestId, fingerprint);
      if (existing) return { status: 200, body: { ...structuredClone(existing.result), replayed: true } };
      const room = roomOf(state(), id);
      if (room.documents.length >= LIMITS.documents) fail(409, 'PRODUCT_LIBRARY_LIMIT', 'The bounded document list is full.');
      if (evidenceId !== null && !room.pin.context.evidence.some(item => item.id === evidenceId))
        fail(400, 'PRODUCT_LIBRARY_CITATION_UNKNOWN', 'The linked evidence id is not present on the pinned Product Context.');
      let created;
      try {
        created = await artifacts.create({
          requestId: `product-library-${requestId}`,
          filename,
          base64: body.base64,
          ...(mimeType ? { mimeType } : {}),
          title: label,
          description: `Product Library document for ${id}`,
          metadata: { productLibrary: { productId: id, evidenceId } },
        });
      } catch (error) {
        if (error?.code === 'IDEMPOTENCY_CONFLICT') fail(409, 'PRODUCT_LIBRARY_IDEMPOTENCY_CONFLICT', 'This requestId already belongs to a different artifact.');
        if (error?.code === 'UNSUPPORTED_ARTIFACT_TYPE' || error?.code === 'INVALID_FILENAME') fail(400, 'PRODUCT_LIBRARY_DOCUMENT_TYPE', 'Use txt, md, csv, json, pdf, png, jpg, jpeg or webp.');
        if (error?.code === 'ARTIFACT_TOO_LARGE') fail(413, 'PRODUCT_LIBRARY_DOCUMENT_TOO_LARGE', 'The artifact store refused the document size.');
        fail(error?.status && error.status < 500 ? 400 : 503, 'PRODUCT_LIBRARY_ARTIFACT_FAILED', 'The harness artifact store refused the document.');
      }
      const artifact = created?.artifact;
      if (!artifact || !UUID.test(artifact.id) || artifact.size !== bytes.length || artifact.sha256 !== sha256 || typeof artifact.mimeType !== 'string')
        fail(502, 'PRODUCT_LIBRARY_ARTIFACT_INVALID', 'The harness artifact store returned an invalid artifact.');
      const now = at();
      const document = {
        id: randomUUID(), artifactId: artifact.id, filename, mimeType: artifact.mimeType, size: artifact.size,
        sha256: artifact.sha256, label, kind, evidenceId, createdBy: actor.subject, createdAt: now, revision: 1,
      };
      let result;
      try {
        result = await storage.update(next => {
          validateLibraryState(next);
          const data = next[LIBRARY_KEY] ?? (next[LIBRARY_KEY] = defaultState());
          const live = roomOf(data, id);
          const duplicate = live.documents.find(item => item.artifactId === artifact.id);
          if (duplicate) return { productId: id, documentId: duplicate.id, artifactId: duplicate.artifactId, revision: duplicate.revision, replayed: true };
          if (live.documents.length >= LIMITS.documents) fail(409, 'PRODUCT_LIBRARY_LIMIT', 'The bounded document list is full.');
          live.documents.push(document);
          live.roomRevision += 1; live.updatedAt = now;
          const summary = { productId: id, documentId: document.id, artifactId: document.artifactId, sha256: document.sha256, size: document.size, revision: document.revision };
          remember(data, actor, requestId, fingerprint, 'attachDocument', summary);
          return { ...summary, replayed: false };
        });
      } catch (error) {
        await Promise.resolve(artifacts.delete?.(artifact.id)).catch(() => {});
        throw error;
      }
      return { status: result.replayed ? 200 : 201, body: result };
    },

    async downloadDocument(context, productIdInput, documentIdInput) {
      actorOf(context, workspaceId);
      const id = productId(productIdInput), documentId = uuid(documentIdInput);
      const room = roomOf(state(), id);
      const document = room.documents.find(item => item.id === documentId);
      if (!document) fail(404, 'PRODUCT_LIBRARY_DOCUMENT_NOT_FOUND', 'This Product Library document does not exist.');
      let download;
      try { download = await artifacts.download(document.artifactId); }
      catch { fail(410, 'PRODUCT_LIBRARY_DOCUMENT_UNAVAILABLE', 'The stored document is no longer available.'); }
      if (!download || !Buffer.isBuffer(download.bytes) || download.bytes.length !== document.size
        || createHash('sha256').update(download.bytes).digest('hex') !== document.sha256)
        fail(502, 'PRODUCT_LIBRARY_DOCUMENT_INVALID', 'The stored document bytes do not match their recorded hash.');
      return { document: structuredClone(document), bytes: download.bytes, filename: download.filename ?? document.filename, mimeType: download.mimeType ?? document.mimeType };
    },

    async approve(context, productIdInput, pageIdInput, body = {}) {
      const actor = actorOf(context, workspaceId);
      if (actor.role !== 'admin') fail(403, 'PRODUCT_LIBRARY_FORBIDDEN', 'Only an administrator may approve a Product Library page.');
      const id = productId(productIdInput), pageId = uuid(pageIdInput);
      const requestId = uuid(body.requestId);
      const expectedRevision = integer(body.expectedRevision);
      if (typeof body.approved !== 'boolean') fail(400, 'PRODUCT_LIBRARY_INPUT', 'Use an explicit approved Boolean.');
      const fingerprint = fingerprintOf('approve', id, pageId, { expectedRevision, approved: body.approved });
      const existing = receiptOf(state(), actor, requestId, fingerprint);
      if (existing) return { status: 200, body: { ...structuredClone(existing.result), replayed: true } };
      const result = await storage.update(next => {
        validateLibraryState(next);
        const data = next[LIBRARY_KEY] ?? (next[LIBRARY_KEY] = defaultState());
        const live = roomOf(data, id), target = pageOf(live, pageId);
        if (target.revision !== expectedRevision) fail(409, 'PRODUCT_LIBRARY_REVISION_CONFLICT', 'This page changed. Reload before reviewing.');
        const now = at();
        target.revision += 1; target.updatedAt = now; live.updatedAt = now;
        target.status = body.approved ? 'approved' : 'draft';
        target.approvedAt = body.approved ? now : null; target.approvedBy = body.approved ? actor.subject : null;
        const summary = { productId: id, pageId, revision: target.revision, status: target.status };
        remember(data, actor, requestId, fingerprint, 'approve', summary);
        return summary;
      });
      return { status: 200, body: { ...result, replayed: false } };
    },
  });
}
