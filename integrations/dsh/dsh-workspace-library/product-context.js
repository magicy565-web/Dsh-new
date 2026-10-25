// A read-only view over the existing library. Document bodies stay in the native reference reader.
import { createHash } from 'node:crypto';
import { referenceMetadata, isReadableReference, REFERENCE_LIMITS } from './references.js';

export const PRODUCT_CONTEXT_LIMITS = Object.freeze({ maxChars: 64_000, maxBytes: 192_000 });
const PRODUCT_ID = /^prd_[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const CERTIFICATES = new Set(['license', 'certificate', 'test_report']);
const SUPPLY = ['packaging', 'samplePolicy', 'paymentTerms', 'shippingTerms', 'capacityNote'];

export class ProductContextError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new ProductContextError(code, message, status); };
const check = signal => { if (signal?.aborted) fail('PRODUCT_CONTEXT_CANCELLED', 'Product context reading was cancelled.', 409); };
const filled = value => typeof value === 'string' && value.trim().length > 0;
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex');

function validityOf(document, version, day) {
  if (!CERTIFICATES.has(document.slotKey)) return 'not-applicable';
  const certificate = version.certificate;
  if (!certificate || certificate.expiryMode === 'unknown') return 'unknown';
  if (certificate.validFrom && certificate.validFrom > day) return 'not-yet-valid';
  if (certificate.expiryMode === 'no_expiry') return 'no-fixed-expiry';
  if (!certificate.validUntil) return 'unknown';
  return certificate.validUntil < day ? 'expired' : 'within-dates';
}

function linkedDocument(state, link, day) {
  const document = state.documents.find(item => item.id === link.documentId);
  const version = document?.versions.find(item => item.version === link.documentVersion);
  const base = { documentId: link.documentId, version: link.documentVersion, purpose: link.purpose,
    contentRead: false, byteIntegrity: 'not-checked', reference: null, readWith: null };
  if (!document) return { ...base, availability: 'missing-document' };
  if (!version) return { ...base, title: document.title, status: document.status, currentVersion: document.currentVersion, availability: 'missing-version' };
  const source = referenceMetadata(document, version);
  const validPin = SHA.test(version.sha256 ?? '');
  const availability = document.status !== 'active' ? 'archived' : !validPin ? 'invalid-pin'
    : !isReadableReference(version) ? 'unsupported-format'
      : !Number.isSafeInteger(version.bytes) || version.bytes < 1 || version.bytes > REFERENCE_LIMITS.maxBytes ? 'too-large' : 'text-reference';
  return { ...base, ...source, status: document.status, slotKey: document.slotKey,
    availability, validity: validityOf(document, version, day),
    reference: availability === 'text-reference' ? { documentId: document.id, version: version.version, sha256: version.sha256 } : null,
    readWith: availability === 'text-reference' ? 'workspace_library_references' : null };
}

function findGaps(company, product, documents) {
  const gaps = [];
  const add = (path, code, message, source = {}) => gaps.push({ path, code, message, ...source });
  if (!filled(company.displayName) && !filled(company.legalName)) add('company', 'MISSING_FIELD', 'No company name is stored.');
  for (const field of ['name', 'description', 'category'])
    if (!filled(product[field])) add(`product.${field}`, 'MISSING_FIELD', `No ${field} is stored.`);
  if (!product.skus.length) add('product.skus', 'MISSING_SKUS', 'No SKUs are stored.');
  for (const [index, sku] of product.skus.entries()) {
    const path = `product.skus[${index}]`;
    for (const field of ['code', 'unit']) if (!filled(sku[field])) add(`${path}.${field}`, 'MISSING_FIELD', `No SKU ${field} is stored.`);
    for (const field of ['moq', 'leadTimeDays']) if (sku[field] === null || sku[field] === undefined)
      add(`${path}.${field}`, 'MISSING_FIELD', `No SKU ${field} is stored.`);
    if (!sku.specs.length) add(`${path}.specs`, 'MISSING_SPECS', 'No SKU specifications are stored.');
    for (const [specIndex, spec] of sku.specs.entries()) if (!filled(spec.value))
      add(`${path}.specs[${specIndex}].value`, 'MISSING_FIELD', 'This specification has no stored value.');
    if (sku.pricingMode === 'unset') add(`${path}.pricingMode`, 'MISSING_PRICING', 'Pricing has not been entered.');
    if (sku.pricingMode === 'on_request') add(`${path}.pricingMode`, 'QUOTE_REQUIRED', 'The price requires a separate quotation.');
  }
  for (const field of SUPPLY) if (!filled(product.supply[field])) add(`product.supply.${field}`, 'MISSING_FIELD', `No ${field} is stored.`);
  if (!documents.length) add('documents', 'NO_LINKED_DOCUMENTS', 'This product has no linked source documents.');
  for (const [index, document] of documents.entries()) {
    const path = `documents[${index}]`;
    const source = { documentId: document.documentId, version: document.version };
    if (document.availability !== 'text-reference') add(path, 'DOCUMENT_UNAVAILABLE', `Document text cannot be read here: ${document.availability}.`, source);
    if (document.isCurrentVersion === false) add(path, 'HISTORICAL_VERSION', 'The product pins a historical version; do not substitute the latest version or call it current policy.', source);
    if (document.reviewState && document.reviewState !== 'verified')
      add(path, document.reviewState === 'rejected' ? 'DOCUMENT_REJECTED' : 'DOCUMENT_UNREVIEWED', 'This exact source version is not human-approved evidence.', source);
    if (['unknown', 'expired', 'not-yet-valid'].includes(document.validity))
      add(path, 'CERTIFICATE_VALIDITY', `Certificate date status: ${document.validity}. Past approval does not establish current validity.`, source);
  }
  return gaps;
}

export async function readProductContext({ readState, productId, expectedRevision, signal, clock = Date.now }) {
  if (typeof productId !== 'string' || !PRODUCT_ID.test(productId)) fail('PRODUCT_CONTEXT_INPUT', 'Select one exact prd_ product id.');
  if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1))
    fail('PRODUCT_CONTEXT_INPUT', 'expectedRevision must be a positive integer.');
  check(signal);
  // Clone one snapshot before resolving any links; never combine reads of different product revisions.
  const state = structuredClone(await readState());
  check(signal);
  const product = state.products.find(item => item.id === productId);
  if (!product) fail('PRODUCT_CONTEXT_NOT_FOUND', 'The selected product does not exist.', 404);
  if (product.status === 'archived') fail('PRODUCT_CONTEXT_ARCHIVED', 'The selected product is archived.', 409);
  if (expectedRevision !== undefined && expectedRevision !== product.revision)
    fail('PRODUCT_CONTEXT_CHANGED', 'The selected product revision has changed. Read it again.', 409);
  const asOfDate = new Date(clock()).toISOString().slice(0, 10);
  const documents = product.documents.map(link => linkedDocument(state, link, asOfDate));
  const company = state.company;
  const source = { kind: 'workspace-library-product', scope: 'profile', productId, revision: product.revision,
    companyRevision: company.revision, librarySequence: state.sequence,
    snapshotSha256: hash({ company, product, documents }), reviewState: 'unreviewed' };
  const result = { source, asOfDate, company, product, documents, gaps: findGaps(company, product, documents),
    internalPricing: true, documentContentIncluded: false, documentReadLimits: REFERENCE_LIMITS, contentRole: 'reference-data' };
  const wire = JSON.stringify(result);
  if (wire.length > PRODUCT_CONTEXT_LIMITS.maxChars || Buffer.byteLength(wire, 'utf8') > PRODUCT_CONTEXT_LIMITS.maxBytes)
    fail('PRODUCT_CONTEXT_TOO_LARGE', 'This product context exceeds the bounded view. Use workspace_library_products and read selected document versions separately; no fields were silently truncated.', 413);
  check(signal);
  return result;
}
