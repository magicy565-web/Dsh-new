import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { ApiError } from './runtime.mjs';
import { validateJson } from './store.mjs';

const fail = (code, message, status = 400) => { throw new ApiError(status, code, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : object(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const conversationId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const productFields = ['companyId', 'name', 'description', 'category', 'status', 'skus', 'images', 'supply', 'documents', 'source'];
const documentFields = ['companyId', 'title', 'slotKey', 'tags', 'status', 'source'];
const slots = ['company', 'license', 'certificate', 'test_report', 'specification', 'supply_policy', 'other'];
const supplyFields = ['packaging', 'samplePolicy', 'paymentTerms', 'shippingTerms', 'capacityNote'];
const emptySupply = () => Object.fromEntries(supplyFields.map(key => [key, '']));
function fields(body, allowed, label = 'input') {
  if (!object(body)) fail('INVALID_INPUT', `${label} must be an object.`);
  try { validateJson(body); } catch { fail('INVALID_INPUT', `${label} must contain safe JSON values.`); }
  for (const key of Object.keys(body)) if (!allowed.includes(key)) fail('INVALID_INPUT', `Unsupported ${label} field: ${key}.`);
}
function text(value, key, max = 4000, empty = true) {
  if (typeof value !== 'string' || value.length > max || !empty && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('INVALID_INPUT', `${key} must be ${empty ? '0' : '1'}–${max} characters.`);
  return value.trim();
}
function integer(value, key, max = 1_000_000_000, nullable = false) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail('INVALID_INPUT', `${key} must be a positive integer${nullable ? ' or null' : ''}.`);
  return value;
}
function member(value, key, choices) { if (!choices.includes(value)) fail('INVALID_INPUT', `${key} must be one of ${choices.join(', ')}.`); return value; }
function array(value, key, max) { if (!Array.isArray(value) || value.length > max) fail('INVALID_INPUT', `${key} must be an array of at most ${max} items.`); return value; }
function unique(values, key) { if (new Set(values).size !== values.length) fail('INVALID_INPUT', `${key} must be unique.`); }
function id(value, key) { if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_INPUT', `${key} must be a UUID.`); return value; }
function date(value, key) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail('INVALID_INPUT', `${key} must be YYYY-MM-DD or null.`);
  return value;
}
function certificate(value = {}) {
  fields(value, ['number', 'issuer', 'scope', 'validFrom', 'validUntil', 'expiryMode', 'expiryNote'], 'certificate');
  const result = { number: text(value.number ?? '', 'number', 200), issuer: text(value.issuer ?? '', 'issuer', 300), scope: text(value.scope ?? '', 'scope'), validFrom: date(value.validFrom ?? null, 'validFrom'), validUntil: date(value.validUntil ?? null, 'validUntil'), expiryMode: member(value.expiryMode ?? 'unknown', 'expiryMode', ['unknown', 'dated', 'no_expiry']), expiryNote: text(value.expiryNote ?? '', 'expiryNote') };
  if (result.validFrom && result.validUntil && result.validFrom > result.validUntil) fail('INVALID_INPUT', 'validFrom must precede validUntil.');
  if (result.expiryMode === 'no_expiry' && !result.expiryNote) fail('INVALID_INPUT', 'no_expiry requires expiryNote.');
  if (result.expiryMode === 'dated' && !result.validUntil) fail('INVALID_INPUT', 'dated expiry requires validUntil.');
  return result;
}
function asset(value) { fields(value, ['artifactId', 'version', 'sha256'], 'asset'); id(value.artifactId, 'artifactId'); integer(value.version, 'version', 100); if (!/^[a-f0-9]{64}$/u.test(value.sha256)) fail('INVALID_INPUT', 'sha256 must be a saved SHA-256 hash.'); return structuredClone(value); }
const defaultSource = () => ({ kind: 'user_provided', referenceOnly: false, sourceUrl: null, fetchedAt: null, batchId: null, fieldSources: [] });
function publicUrl(value) {
  text(value, 'sourceUrl', 2000, false);
  let url; try { url = new URL(value); } catch { fail('INVALID_INPUT', 'sourceUrl must be an HTTPS public URL.'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (url.protocol !== 'https:' || url.username || url.password || isIP(host) || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal)$/u.test(host)) fail('INVALID_INPUT', 'sourceUrl must be an HTTPS public hostname without credentials.');
  return url.href;
}
function source(value, requireName = false) {
  if (value === null) return null;
  fields(value, ['kind', 'referenceOnly', 'sourceUrl', 'fetchedAt', 'batchId', 'fieldSources'], 'source');
  member(value.kind, 'source kind', ['user_provided', 'public_reference']);
  if (value.kind === 'user_provided') {
    if (canonical(value) !== canonical(defaultSource())) fail('INVALID_INPUT', 'User-provided sources must not claim captured public provenance.');
    return defaultSource();
  }
  if (value.referenceOnly !== true) fail('INVALID_INPUT', 'Public references must remain referenceOnly.');
  const url = publicUrl(value.sourceUrl);
  if (typeof value.fetchedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value.fetchedAt) || !Number.isFinite(Date.parse(value.fetchedAt))) fail('INVALID_INPUT', 'fetchedAt must be a UTC ISO timestamp.');
  id(value.batchId, 'batchId');
  const fieldSources = array(value.fieldSources, 'fieldSources', 100).map(entry => {
    fields(entry, ['fieldPath', 'sourceUrl', 'locator', 'capturedValue'], 'field source');
    const fieldPath = text(entry.fieldPath, 'fieldPath', 200, false);
    if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.(?:[A-Za-z][A-Za-z0-9_]*|0|[1-9]\d{0,2}))*$/u.test(fieldPath) || /^(?:source|supply|documents|companyId)(?:\.|$)/u.test(fieldPath) || /(?:^|\.)(?:moq|priceTiers|pricingMode|pricingNote|leadTimeDays)(?:\.|$)/u.test(fieldPath)) fail('INVALID_INPUT', 'Public field provenance cannot claim enterprise supply, prices or qualification.');
    text(entry.capturedValue, 'capturedValue', 4000);
    return { fieldPath, sourceUrl: publicUrl(entry.sourceUrl), locator: text(entry.locator, 'locator', 2000, false), capturedValue: entry.capturedValue };
  });
  if (!fieldSources.length || requireName && !fieldSources.some(entry => entry.fieldPath === 'name')) fail('INVALID_INPUT', 'Public references require captured field provenance, including product name.');
  unique(fieldSources.map(entry => entry.fieldPath), 'field source paths');
  return { kind: 'public_reference', referenceOnly: true, sourceUrl: url, fetchedAt: value.fetchedAt, batchId: value.batchId, fieldSources };
}
function sourceChange(changes, original, requireName) {
  if (original.source?.kind === 'public_reference' && Object.hasOwn(changes, 'source') && canonical(changes.source) !== canonical(original.source)) fail('INVALID_INPUT', 'Public reference provenance is immutable; local edits cannot turn it into enterprise inventory.');
  if (Object.hasOwn(changes, 'source') || Object.hasOwn(original, 'source')) return source(Object.hasOwn(changes, 'source') ? changes.source : original.source, requireName);
  return undefined;
}
function sku(value) {
  fields(value, ['id', 'code', 'specs', 'unit', 'moq', 'pricingMode', 'pricingNote', 'priceTiers', 'leadTimeDays'], 'SKU');
  const result = { id: id(value.id, 'SKU id'), code: text(value.code, 'SKU code', 100, false), specs: array(value.specs ?? [], 'specs', 20).map(entry => { fields(entry, ['key', 'value'], 'spec'); return { key: text(entry.key, 'spec key', 100, false), value: text(entry.value, 'spec value', 500, false) }; }), unit: text(value.unit ?? '', 'unit', 100), moq: integer(value.moq ?? null, 'moq', 1_000_000_000, true), pricingMode: member(value.pricingMode ?? 'unset', 'pricingMode', ['unset', 'tiered', 'on_request']), pricingNote: text(value.pricingNote ?? '', 'pricingNote'), priceTiers: array(value.priceTiers ?? [], 'priceTiers', 20).map(entry => { fields(entry, ['minQuantity', 'unitPrice', 'currency'], 'price tier'); integer(entry.minQuantity, 'minQuantity'); if (typeof entry.unitPrice !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/u.test(entry.unitPrice) || Number(entry.unitPrice) <= 0) fail('INVALID_INPUT', 'unitPrice must be a positive decimal string.'); if (typeof entry.currency !== 'string' || !/^[A-Z]{3}$/u.test(entry.currency)) fail('INVALID_INPUT', 'currency must be three uppercase letters.'); return structuredClone(entry); }), leadTimeDays: integer(value.leadTimeDays ?? null, 'leadTimeDays', 36500, true) };
  unique(result.specs.map(entry => entry.key.toLocaleLowerCase()), 'spec keys');
  if (result.priceTiers.some((entry, index) => index && entry.minQuantity <= result.priceTiers[index - 1].minQuantity)) fail('INVALID_INPUT', 'price tier quantities must increase.');
  if (result.priceTiers.length && result.pricingMode !== 'tiered') fail('INVALID_INPUT', 'Only tiered pricing may contain priceTiers.');
  if (new Set(result.priceTiers.map(entry => entry.currency)).size > 1) fail('INVALID_INPUT', 'A SKU must use one tier currency.');
  return result;
}
function normalizeProduct(changes, original) {
  fields(changes, productFields, 'product');
  const next = { ...original, ...changes };
  if (next.companyId !== 'company') fail('INVALID_INPUT', 'companyId must be company.');
  next.name = text(next.name, 'name', 200, false); next.description = text(next.description, 'description', 16000); next.category = text(next.category, 'category', 200);
  next.status = member(next.status, 'status', ['draft', 'archived']); next.skus = array(next.skus, 'skus', 100).map(sku); unique(next.skus.map(entry => entry.id), 'SKU ids'); unique(next.skus.map(entry => entry.code.toLocaleLowerCase()), 'SKU codes');
  next.images = array(next.images, 'images', 10).map(entry => { fields(entry, ['id', 'asset', 'alt', 'order', 'isPrimary'], 'image'); if (typeof entry.isPrimary !== 'boolean' || !Number.isSafeInteger(entry.order) || entry.order < 0 || entry.order > 1000) fail('INVALID_INPUT', 'Images require order and isPrimary.'); return { id: id(entry.id, 'image id'), asset: asset(entry.asset), alt: text(entry.alt ?? '', 'alt', 1000), order: entry.order, isPrimary: entry.isPrimary }; }); unique(next.images.map(entry => entry.id), 'image ids'); if (next.images.filter(entry => entry.isPrimary).length > 1) fail('INVALID_INPUT', 'Select at most one primary image.');
  fields(next.supply, supplyFields, 'supply'); next.supply = Object.fromEntries(supplyFields.map(key => [key, text(next.supply[key] ?? '', key)]));
  next.documents = array(next.documents, 'documents', 50).map(entry => { fields(entry, ['documentId', 'documentVersion', 'purpose'], 'document reference'); return { documentId: id(entry.documentId, 'documentId'), documentVersion: integer(entry.documentVersion, 'documentVersion', 100), purpose: text(entry.purpose ?? '', 'purpose', 1000) }; }); unique(next.documents.map(entry => `${entry.documentId}/${entry.documentVersion}`), 'document references');
  const provenance = sourceChange(changes, original, true); if (provenance !== undefined) next.source = provenance;
  if (next.source?.kind === 'public_reference' && (next.skus.some(entry => entry.moq !== null || entry.leadTimeDays !== null || entry.pricingMode !== 'unset' || entry.priceTiers.length || entry.pricingNote) || Object.values(next.supply).some(Boolean))) fail('INVALID_INPUT', 'Public references cannot supply enterprise MOQ, quotes, lead times or supply policies.');
  return next;
}
function assertPublicDocument(item) {
  if (item.source?.kind !== 'public_reference') return;
  if (!['specification', 'other'].includes(item.slotKey) || item.versions.some(entry => canonical(entry.certificate) !== canonical(certificate()))) fail('INVALID_INPUT', 'Public reference documents are specifications or notes, never enterprise certificates or qualification.');
}
function normalizeDocument(changes, original) { fields(changes, documentFields, 'document'); const next = { ...original, ...changes }; if (next.companyId !== 'company') fail('INVALID_INPUT', 'companyId must be company.'); next.title = text(next.title, 'title', 200, false); next.slotKey = member(next.slotKey, 'slotKey', slots); next.status = member(next.status, 'status', ['active', 'archived']); next.tags = array(next.tags, 'tags', 20).map(entry => text(entry, 'tag', 100, false)); unique(next.tags, 'tags'); const provenance = sourceChange(changes, original, false); if (provenance !== undefined) next.source = provenance; assertPublicDocument(next); return next; }
function library(state) { const result = state.businessLibrary; if (!result || result.version !== 1) fail('STORAGE_UNAVAILABLE', 'Business library storage is unavailable.', 503); return result; }
function required(state, type, value) { const entity = library(state)[type].find(entry => entry.id === value); if (!entity) fail('NOT_FOUND', 'Library item not found.', 404); return entity; }
function checkSize(entity) { if (Buffer.byteLength(JSON.stringify(entity)) > 65536) fail('ENTITY_TOO_LARGE', 'Library items must fit within 64 KiB.', 413); }
function revision(entity, expectedRevision) { integer(expectedRevision, 'expectedRevision'); if (entity.revision !== expectedRevision) fail('REVISION_CONFLICT', 'This item changed. Your draft has not been applied; reload the latest version before saving.', 409); }
function permission(actor, review = false) { if (!actor || !(review ? ['admin'] : ['admin', 'operator']).includes(actor.role)) fail('ROLE_REQUIRED', review ? 'An administrator must review documents.' : 'An operator or administrator must save library items.', 403); }
function publicOperation(entry, duplicate = false) { return Object.fromEntries(['requestId', 'entityType', 'entityId', 'committedRevision', 'committedAt'].map(key => [key, entry[key]]).concat([['duplicate', duplicate]])); }
function assertAsset(state, ref, image = false) {
  const record = state.artifacts.find(entry => entry.id === ref.artifactId), version = record?.versions.find(entry => entry.version === ref.version);
  if (!record || !version || version.sha256 !== ref.sha256) fail('LINK_CONFLICT', 'The exact staged file version no longer exists or its hash changed.', 409);
  if (image && !version.mimeType.startsWith('image/')) fail('INVALID_INPUT', 'Product images require an image artifact.');
  return record;
}
function claimAsset(state, ref, image = false) { const record = assertAsset(state, ref, image); if (record.metadata?.businessLibrary?.visibility !== 'internal') { record.metadata = { ...record.metadata, businessLibrary: { ...(record.metadata?.businessLibrary || {}), visibility: 'internal' } }; record.revision++; record.updatedAt = new Date().toISOString(); } }
function checkProductLinks(state, item) {
  for (const image of item.images) claimAsset(state, image.asset, true);
  for (const ref of item.documents) { const doc = required(state, 'documents', ref.documentId); if (!doc.versions.some(entry => entry.version === ref.documentVersion)) fail('LINK_CONFLICT', 'The selected document version does not exist.', 409); if (item.source?.kind === 'public_reference' && (doc.source?.kind !== 'public_reference' || !['specification', 'other'].includes(doc.slotKey))) fail('LINK_CONFLICT', 'Public reference products may link only public reference specification or notes.'); }
  const otherCodes = new Set(library(state).products.filter(entry => entry.id !== item.id).flatMap(entry => entry.skus.map(value => value.code.toLocaleLowerCase()))); if (item.skus.some(entry => otherCodes.has(entry.code.toLocaleLowerCase()))) fail('LINK_CONFLICT', 'SKU codes must be unique across this enterprise.', 409);
}
function validatePersistedLibrary(state) {
  const lib = library(state);
  fields(lib, ['version', 'company', 'products', 'documents', 'operations', 'conversationReferences'], 'stored library');
  fields(lib.company, ['id', 'revision', 'legalName', 'displayName', 'description', 'createdAt', 'updatedAt'], 'stored company');
  for (const key of ['legalName', 'displayName', 'description']) text(lib.company[key], key, key === 'description' ? 16000 : 300);
  const timestamps = entity => {
    id(entity.id, 'stored id'); integer(entity.revision, 'stored revision');
    for (const key of ['createdAt', 'updatedAt']) if (typeof entity[key] !== 'string' || !Number.isFinite(Date.parse(entity[key]))) fail('INVALID_INPUT', 'Invalid stored library timestamp.');
    checkSize(entity);
  };
  array(lib.products, 'stored products', 1000); array(lib.documents, 'stored documents', 1000); array(lib.operations, 'stored operations', 10000);
  const codes = [];
  for (const product of lib.products) {
    fields(product, ['id', 'revision', 'createdAt', 'updatedAt', ...productFields], 'stored product'); timestamps(product);
    if (canonical(normalizeProduct({}, product)) !== canonical(product)) fail('INVALID_INPUT', 'Stored product fields are not canonical.');
    codes.push(...product.skus.map(entry => entry.code.toLocaleLowerCase()));
    for (const image of product.images) assertAsset(state, image.asset, true);
    for (const ref of product.documents) if (!required(state, 'documents', ref.documentId).versions.some(entry => entry.version === ref.documentVersion)) fail('INVALID_INPUT', 'A stored document reference is invalid.');
  }
  unique(codes, 'enterprise SKU codes');
  for (const doc of lib.documents) {
    fields(doc, ['id', 'revision', 'createdAt', 'updatedAt', 'currentVersion', 'versions', 'reviews', ...documentFields], 'stored document'); timestamps(doc);
    if (canonical(normalizeDocument({}, doc)) !== canonical(doc)) fail('INVALID_INPUT', 'Stored document fields are not canonical.');
    const versions = array(doc.versions, 'stored versions', 100); if (!versions.length || doc.currentVersion !== versions.length) fail('INVALID_INPUT', 'Invalid document version sequence.');
    for (const [index, version] of versions.entries()) {
      fields(version, ['version', 'asset', 'certificate', 'createdAt', 'createdBy'], 'stored document version');
      if (version.version !== index + 1 || typeof version.createdAt !== 'string' || !Number.isFinite(Date.parse(version.createdAt))) fail('INVALID_INPUT', 'Invalid document version sequence.');
      text(version.createdBy, 'stored actor', 128, false); asset(version.asset); assertAsset(state, version.asset);
      if (canonical(certificate(version.certificate)) !== canonical(version.certificate)) fail('INVALID_INPUT', 'Invalid stored certificate fields.');
    }
    for (const review of array(doc.reviews, 'stored reviews', 200)) {
      fields(review, ['id', 'documentId', 'documentVersion', 'sha256', 'decision', 'note', 'reviewedAt', 'reviewedBy'], 'stored review');
      id(review.id, 'review id'); member(review.decision, 'review decision', ['verified', 'rejected']); text(review.note, 'review note'); text(review.reviewedBy, 'review actor', 128, false);
      if (review.documentId !== doc.id || !doc.versions.some(version => version.version === review.documentVersion && version.asset.sha256 === review.sha256) || !Number.isFinite(Date.parse(review.reviewedAt))) fail('INVALID_INPUT', 'Invalid exact-version review.');
    }
  }
  for (const operation of lib.operations) {
    id(operation.requestId, 'stored requestId'); if (operation.id !== operation.requestId || !/^[a-f0-9]{64}$/u.test(operation.fingerprint) || !Number.isFinite(Date.parse(operation.committedAt))) fail('INVALID_INPUT', 'Invalid operation receipt.');
    text(operation.actor, 'operation actor', 128, false); member(operation.entityType, 'operation entity type', ['company', 'product', 'document', 'libraryReferences']); integer(operation.committedRevision, 'committedRevision');
    if (!object(operation.response) || !object(operation.response[operation.entityType]) || (operation.response[operation.entityType].id ?? operation.response[operation.entityType].conversationId) !== operation.entityId || operation.response[operation.entityType].revision !== operation.committedRevision) fail('INVALID_INPUT', 'Operation receipt does not match its saved response.');
  }
  for (const binding of array(lib.conversationReferences ?? [], 'stored conversation references', 1000)) {
    fields(binding, ['id', 'conversationId', 'revision', 'products', 'documents', 'updatedAt'], 'stored conversation reference');
    if (!conversationId(binding.conversationId)) fail('INVALID_INPUT', 'Invalid original conversation identity.'); integer(binding.revision, 'reference revision');
    if (binding.id !== binding.conversationId || !Number.isFinite(Date.parse(binding.updatedAt))) fail('INVALID_INPUT', 'Invalid stored conversation references.');
    referenceSelection({ products: binding.products, documents: binding.documents });
  }
}
function referenceSelection(value) {
  fields(value, ['products', 'documents'], 'references');
  const products = array(value.products, 'product references', 50).map(entry => { fields(entry, ['productId', 'productRevision'], 'product reference'); return { productId: id(entry.productId, 'productId'), productRevision: integer(entry.productRevision, 'productRevision') }; });
  const documents = array(value.documents, 'document references', 50).map(entry => { fields(entry, ['documentId', 'documentVersion'], 'document reference'); return { documentId: id(entry.documentId, 'documentId'), documentVersion: integer(entry.documentVersion, 'documentVersion', 100) }; });
  unique(products.map(entry => entry.productId), 'selected product ids'); unique(documents.map(entry => `${entry.documentId}/${entry.documentVersion}`), 'selected document versions');
  return { products, documents };
}
function requiredConversation(state, conversationId) {
  if (!state.conversations.some(entry => entry.id === conversationId)) fail('NOT_FOUND', 'Conversation not found.', 404);
}
function publicReferences(binding) {
  return Object.fromEntries(['conversationId', 'revision', 'products', 'documents', 'updatedAt'].map(key => [key, binding[key]]));
}
function resolvedReferences(state, binding) {
  const lib = library(state);
  return {
    products: binding.products.map(ref => { const current = lib.products.find(entry => entry.id === ref.productId); return { ...ref, status: !current ? 'missing' : current.status === 'archived' ? 'archived' : current.revision === ref.productRevision ? 'current' : 'updated', currentRevision: current?.revision ?? null }; }),
    documents: binding.documents.map(ref => { const current = lib.documents.find(entry => entry.id === ref.documentId); return { ...ref, status: !current || !current.versions.some(entry => entry.version === ref.documentVersion) ? 'missing' : current.status === 'archived' ? 'archived' : current.currentVersion === ref.documentVersion ? 'current' : 'updated', currentVersion: current?.currentVersion ?? null }; }),
  };
}
export function isArtifactReferencedByLibrary(state, artifactId) { return (state.businessLibrary?.documents || []).some(doc => doc.versions.some(entry => entry.asset.artifactId === artifactId)) || (state.businessLibrary?.products || []).some(product => product.images.some(entry => entry.asset.artifactId === artifactId)); }

/** Enterprise-private metadata, using the existing workspace transaction and inert artifact bytes. */
export function createBusinessLibraryService({ store, artifacts, clock = Date.now } = {}) {
  try { validatePersistedLibrary(store.read()); }
  catch (error) { throw new Error('Invalid business library metadata; no library data has been changed.', { cause: error }); }
  async function verifyAssets(refs, image = false) { for (const ref of refs) { asset(ref); const file = await artifacts.download(ref.artifactId, { version: ref.version }); if (file.version.sha256 !== ref.sha256) fail('LINK_CONFLICT', 'Staged file hash does not match the selected asset.', 409); if (image && !file.mimeType.startsWith('image/')) fail('INVALID_INPUT', 'Product images require image files.'); } }
  async function write({ body, allowed, type, entityId, actor, review = false, assets = [], image = false, mutate }) {
    permission(actor, review); fields(body, ['requestId', ...allowed]); id(body.requestId, 'requestId'); const fingerprint = hash({ type, entityId, body });
    const previous = library(store.read()).operations.find(entry => entry.requestId === body.requestId);
    const duplicate = entry => { if (entry.fingerprint !== fingerprint || entry.actor !== actor.subject) fail('IDEMPOTENCY_CONFLICT', 'This requestId already belongs to a different operation.', 409); return { ...entry.response, operation: publicOperation(entry, true) }; };
    if (previous) return duplicate(previous);
    await verifyAssets(assets, image);
    return store.update(state => {
      const lib = library(state), prior = lib.operations.find(entry => entry.requestId === body.requestId); if (prior) return duplicate(prior);
      if (lib.operations.length >= 10000) fail('STORAGE_LIMIT', 'The durable operation receipt limit has been reached; existing requestIds remain queryable.', 409);
      const entity = mutate(state), responseKey = type.startsWith('document') ? 'document' : type === 'company' ? 'company' : type === 'conversationReferences' ? 'libraryReferences' : 'product'; checkSize(entity);
      const operation = { id: body.requestId, requestId: body.requestId, fingerprint, actor: actor.subject, entityType: responseKey, entityId: entity.id ?? entity.conversationId, committedRevision: entity.revision, committedAt: new Date(clock()).toISOString(), response: { [responseKey]: structuredClone(entity) } };
      lib.operations.push(operation); return { [responseKey]: entity, operation: publicOperation(operation) };
    });
  }
  function list(type, query = {}) {
    fields(query, ['q', 'status', 'companyId', 'limit', 'cursor', ...(type === 'documents' ? ['slotKey'] : [])], 'query');
    const q = text(query.q ?? '', 'q', 200).toLocaleLowerCase(), status = query.status === undefined ? null : member(query.status, 'status', type === 'products' ? ['draft', 'archived'] : ['active', 'archived']);
    if (query.companyId !== undefined && query.companyId !== 'company') fail('INVALID_INPUT', 'companyId must be company.'); if (query.slotKey !== undefined) member(query.slotKey, 'slotKey', slots);
    const limit = query.limit === undefined ? 20 : typeof query.limit === 'string' && /^[1-9]\d{0,2}$/u.test(query.limit) ? integer(Number(query.limit), 'limit', 100) : integer(query.limit, 'limit', 100);
    const state = store.read(), binding = hash({ type, q, status, companyId: query.companyId ?? null, slotKey: query.slotKey ?? null, limit }); let offset = 0;
    if (query.cursor !== undefined) { if (typeof query.cursor !== 'string' || query.cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/u.test(query.cursor)) fail('INVALID_INPUT', 'Invalid list cursor.'); let cursor; try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url')); } catch { fail('INVALID_INPUT', 'Invalid list cursor.'); } if (!object(cursor) || cursor.binding !== binding || !Number.isSafeInteger(cursor.offset) || cursor.offset < 1 || cursor.offset > 1000) fail('INVALID_INPUT', 'Cursor does not match this query.'); if (cursor.sequence !== state.meta.sequence) fail('REVISION_CONFLICT', 'The library changed. Restart this list from its first page.', 409); offset = cursor.offset; }
    let items = library(state)[type].filter(entry => (!status || entry.status === status) && (!query.slotKey || entry.slotKey === query.slotKey) && (!q || [entry.name, entry.title, entry.description, entry.category, ...(entry.tags || []), ...(entry.skus || []).map(value => value.code)].filter(Boolean).join('\n').toLocaleLowerCase().includes(q))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const next = offset + limit; return { items: items.slice(offset, next), nextCursor: next < items.length ? Buffer.from(JSON.stringify({ binding, offset: next, sequence: state.meta.sequence })).toString('base64url') : null, sequence: state.meta.sequence };
  }
  return {
    listProducts: query => list('products', query), listDocuments: query => list('documents', query),
    getCompany: () => ({ company: library(store.read()).company }), getProduct: value => ({ product: required(store.read(), 'products', value) }), getDocument: value => ({ document: required(store.read(), 'documents', value) }),
    getOperation(requestId) { id(requestId, 'requestId'); const entry = library(store.read()).operations.find(value => value.requestId === requestId); if (!entry) fail('NOT_FOUND', 'Operation receipt not found.', 404); return { operation: publicOperation(entry) }; },
    getConversationReferences(conversationId) {
      const state = store.read(); requiredConversation(state, conversationId);
      const binding = (library(state).conversationReferences || []).find(entry => entry.conversationId === conversationId) || { conversationId, revision: 0, products: [], documents: [], updatedAt: null };
      return { libraryReferences: publicReferences(binding), resolution: resolvedReferences(state, binding) };
    },
    async updateConversationReferences(conversationId, body, actor) {
      const saved = await write({ body, allowed: ['expectedRevision', 'references'], type: 'conversationReferences', entityId: conversationId, actor, mutate(state) {
        requiredConversation(state, conversationId);
        const lib = library(state), original = (lib.conversationReferences || []).find(entry => entry.conversationId === conversationId);
        if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) fail('INVALID_INPUT', 'expectedRevision must be a non-negative integer for conversation references.');
        if ((original?.revision ?? 0) !== body.expectedRevision) fail('REVISION_CONFLICT', 'Conversation references changed; your selection has not been replaced.', 409);
        const selection = referenceSelection(body.references), resolution = resolvedReferences(state, selection);
        if (resolution.products.some(entry => entry.status !== 'current') || resolution.documents.some(entry => ['missing', 'archived'].includes(entry.status))) fail('LINK_CONFLICT', 'A selected item is unavailable or its product revision changed. Reload and choose the exact current product or a saved document version.', 409);
        const binding = { id: conversationId, conversationId, revision: (original?.revision ?? 0) + 1, ...selection, updatedAt: new Date(clock()).toISOString() };
        lib.conversationReferences ??= [];
        if (original) lib.conversationReferences[lib.conversationReferences.findIndex(entry => entry.conversationId === conversationId)] = binding;
        else { if (lib.conversationReferences.length >= 1000) fail('STORAGE_LIMIT', 'Conversation reference limit reached.', 409); lib.conversationReferences.push(binding); }
        return publicReferences(binding);
      } });
      return { ...saved, resolution: resolvedReferences(store.read(), saved.libraryReferences) };
    },
    updateCompany(body, actor) { return write({ body, allowed: ['expectedRevision', 'changes'], type: 'company', entityId: 'company', actor, mutate(state) { const lib = library(state), original = lib.company; revision(original, body.expectedRevision); fields(body.changes, ['legalName', 'displayName', 'description'], 'company'); if (!Object.keys(body.changes).length) fail('INVALID_INPUT', 'Provide company changes.'); const next = { ...original, ...Object.fromEntries(Object.entries(body.changes).map(([key, value]) => [key, text(value, key, key === 'description' ? 16000 : 300)])), revision: original.revision + 1, updatedAt: new Date(clock()).toISOString() }; lib.company = next; return next; } }); },
    createProduct(body, actor) { return write({ body, allowed: productFields, type: 'product', entityId: null, actor, assets: Array.isArray(body.images) ? body.images.map(entry => entry?.asset) : [], image: true, mutate(state) { const lib = library(state); if (lib.products.length >= 1000) fail('STORAGE_LIMIT', 'Product limit reached.', 409); const time = new Date(clock()).toISOString(), { requestId: ignored, ...changes } = body; const item = normalizeProduct(changes, { id: randomUUID(), revision: 1, companyId: 'company', description: '', category: '', status: 'draft', skus: [], images: [], supply: emptySupply(), documents: [], source: defaultSource(), createdAt: time, updatedAt: time }); checkProductLinks(state, item); lib.products.push(item); return item; } }); },
    updateProduct(value, body, actor) { return write({ body, allowed: ['expectedRevision', 'changes'], type: 'product', entityId: value, actor, assets: Array.isArray(body.changes?.images) ? body.changes.images.map(entry => entry?.asset) : [], image: true, mutate(state) { const original = required(state, 'products', value); revision(original, body.expectedRevision); const item = normalizeProduct(body.changes, original); if (!Object.keys(body.changes).length) fail('INVALID_INPUT', 'Provide product changes.'); item.revision++; item.updatedAt = new Date(clock()).toISOString(); checkProductLinks(state, item); library(state).products[library(state).products.findIndex(entry => entry.id === value)] = item; return item; } }); },
    createDocument(body, actor) { return write({ body, allowed: [...documentFields, 'asset', 'certificate'], type: 'document', entityId: null, actor, assets: [body.asset], mutate(state) { const lib = library(state); if (lib.documents.length >= 1000) fail('STORAGE_LIMIT', 'Document limit reached.', 409); const time = new Date(clock()).toISOString(), { requestId: ignored, asset: staged, certificate: cert, ...changes } = body; const ref = asset(staged); claimAsset(state, ref); const item = normalizeDocument(changes, { id: randomUUID(), revision: 1, companyId: 'company', slotKey: 'other', tags: [], status: 'active', source: defaultSource(), currentVersion: 1, versions: [{ version: 1, asset: ref, certificate: certificate(cert), createdAt: time, createdBy: actor.subject }], reviews: [], createdAt: time, updatedAt: time }); lib.documents.push(item); return item; } }); },
    updateDocument(value, body, actor) { return write({ body, allowed: ['expectedRevision', 'changes'], type: 'document', entityId: value, actor, mutate(state) { const original = required(state, 'documents', value); revision(original, body.expectedRevision); const item = normalizeDocument(body.changes, original); if (!Object.keys(body.changes).length) fail('INVALID_INPUT', 'Provide document changes.'); item.revision++; item.updatedAt = new Date(clock()).toISOString(); library(state).documents[library(state).documents.findIndex(entry => entry.id === value)] = item; return item; } }); },
    appendDocumentVersion(value, body, actor) { return write({ body, allowed: ['expectedRevision', 'asset', 'certificate'], type: 'document-version', entityId: value, actor, assets: [body.asset], mutate(state) { const item = required(state, 'documents', value); revision(item, body.expectedRevision); if (item.source?.kind === 'public_reference') fail('INVALID_INPUT', 'Public reference versions cannot be replaced under locked captured provenance. Create a new public reference document instead.'); if (item.versions.length >= 100) fail('STORAGE_LIMIT', 'Document version limit reached.', 409); const ref = asset(body.asset); claimAsset(state, ref); if (item.versions.some(entry => entry.asset.artifactId === ref.artifactId && entry.asset.version === ref.version)) fail('LINK_CONFLICT', 'This exact file is already a version of this document.', 409); const time = new Date(clock()).toISOString(); item.versions.push({ version: item.currentVersion + 1, asset: ref, certificate: certificate(body.certificate), createdAt: time, createdBy: actor.subject }); item.currentVersion++; item.revision++; item.updatedAt = time; return item; } }); },
    reviewDocument(value, version, body, actor) { permission(actor, true); const selected = required(store.read(), 'documents', value).versions.find(entry => entry.version === integer(version, 'documentVersion', 100)); if (!selected) fail('NOT_FOUND', 'Document version not found.', 404); return write({ body, allowed: ['expectedRevision', 'decision', 'note'], type: 'document-review', entityId: `${value}/${version}`, actor, review: true, assets: [selected.asset], mutate(state) { const item = required(state, 'documents', value); revision(item, body.expectedRevision); const selected = item.versions.find(entry => entry.version === integer(version, 'documentVersion', 100)); if (!selected) fail('NOT_FOUND', 'Document version not found.', 404); const decision = member(body.decision, 'decision', ['verified', 'rejected']); const today = new Date(clock()).toISOString().slice(0, 10); if (decision === 'verified' && ['certificate', 'license', 'test_report'].includes(item.slotKey) && (selected.certificate.expiryMode === 'unknown' || selected.certificate.expiryMode === 'dated' && selected.certificate.validUntil < today || selected.certificate.validFrom && selected.certificate.validFrom > today)) fail('INVALID_INPUT', 'Certificate validity must be known and current before verification.'); const time = new Date(clock()).toISOString(); item.reviews.push({ id: randomUUID(), documentId: value, documentVersion: selected.version, sha256: selected.asset.sha256, decision, note: text(body.note ?? '', 'note'), reviewedAt: time, reviewedBy: actor.subject }); if (item.reviews.length > 200) fail('STORAGE_LIMIT', 'Document review history limit reached.', 409); item.revision++; item.updatedAt = time; return item; } }); },
    async readiness(value) {
      const state = store.read(), item = required(state, 'products', value), lib = library(state), time = new Date(clock()).toISOString(), day = time.slice(0, 10), checks = [];
      const add = (key, fieldPath, label, status, message, evidence = []) => checks.push({ key, fieldPath, label, status, message, evidence });
      const present = (key, fieldPath, label, value) => add(key, fieldPath, label, value ? 'verified' : 'missing', value ? '已填写，供内部复核。' : '请补充此项。');
      if (item.source?.kind === 'public_reference') add('public-reference', 'source', '公开参考样本', 'unverified', '这份样本仅作公开资料参考，未确认本企业库存、报价、起订量、交期或资质。', [{ sourceUrl: item.source.sourceUrl, fetchedAt: item.source.fetchedAt, batchId: item.source.batchId }]);
      present('company', 'company.legalName', '企业法定名称', lib.company.legalName); present('name', 'name', '产品名称', item.name); present('description', 'description', '产品描述', item.description); present('category', 'category', '产品分类', item.category);
      if (item.status === 'archived') add('status', 'status', '草稿状态', 'invalid', '已归档产品不能进入准备审核。');
      if (!item.skus.length) add('skus', 'skus', 'SKU与规格', 'missing', '请至少添加一个SKU。');
      for (const [index, entry] of item.skus.entries()) { present(`sku-${entry.id}-specs`, `skus.${index}.specs`, 'SKU规格', entry.specs.length); present(`sku-${entry.id}-unit`, `skus.${index}.unit`, '计量单位', entry.unit); present(`sku-${entry.id}-moq`, `skus.${index}.moq`, '最低起订量', entry.moq); present(`sku-${entry.id}-lead`, `skus.${index}.leadTimeDays`, '交期天数', entry.leadTimeDays); present(`sku-${entry.id}-price`, `skus.${index}.priceTiers`, '内部价格信息', entry.pricingMode === 'tiered' ? entry.priceTiers.length && (!entry.moq || entry.priceTiers[0].minQuantity <= entry.moq) : entry.pricingMode === 'on_request' && entry.pricingNote); }
      for (const [key, label] of Object.entries({ packaging: '包装方式', samplePolicy: '样品政策', paymentTerms: '付款条款', shippingTerms: '运输条款' })) present(`supply-${key}`, `supply.${key}`, label, item.supply[key]);
      if (!item.images.length) add('images', 'images', '产品图片', 'missing', '请添加一张产品图片。');
      for (const image of item.images) { try { const file = await artifacts.download(image.asset.artifactId, { version: image.asset.version }); if (file.version.sha256 !== image.asset.sha256) throw new Error(); add(`image-${image.id}`, 'images', '图片文件完整性', 'verified', '已读取确切图片版本，文件字节与所记录的SHA-256一致。', [image.asset]); } catch { add(`image-${image.id}`, 'images', '图片文件完整性', 'invalid', '图片文件缺失，或文件字节与所记录的哈希不一致。', [image.asset]); } }
      if (!item.documents.length) add('documents', 'documents', '关联资料', 'missing', '请关联至少一份资料的确切版本。');
      const dependencies = [];
      for (const ref of item.documents) { const doc = lib.documents.find(entry => entry.id === ref.documentId), ver = doc?.versions.find(entry => entry.version === ref.documentVersion), key = `document-${ref.documentId}-${ref.documentVersion}`; dependencies.push({ ref, doc }); if (!doc || !ver) { add(key, 'documents', '资料引用', 'invalid', '关联的资料版本不可用。'); continue; } const evidence = [{ documentId: doc.id, documentVersion: ver.version, ...ver.asset }]; if (doc.status !== 'active') { add(key, 'documents', doc.title, 'invalid', '关联资料已归档。', evidence); continue; } try { const file = await artifacts.download(ver.asset.artifactId, { version: ver.asset.version }); if (file.version.sha256 !== ver.asset.sha256) throw new Error(); add(`${key}-integrity`, 'documents', `${doc.title}：文件完整性`, 'verified', '已读取关联的确切资料版本，文件字节与所记录的SHA-256一致。', evidence); } catch { add(`${key}-integrity`, 'documents', doc.title, 'invalid', '关联文件缺失，或未通过完整性检查。', evidence); }
        if (['certificate', 'license', 'test_report'].includes(doc.slotKey)) { const cert = ver.certificate; let status = 'verified', message = '所记录的有效期涵盖今天。'; if (cert.expiryMode === 'unknown') { status = 'unverified'; message = '证书有效期未知，尚未验证。'; } else if (cert.expiryMode === 'dated' && cert.validUntil < day) { status = 'expired'; message = '证书已过期。'; } else if (cert.validFrom && cert.validFrom > day) { status = 'invalid'; message = '证书有效期尚未开始。'; } add(`${key}-validity`, 'documents', `${doc.title}：有效期`, status, message, evidence); }
        const latest = doc.reviews.filter(entry => entry.documentVersion === ver.version && entry.sha256 === ver.asset.sha256).at(-1); add(`${key}-review`, 'documents', `${doc.title}：管理员审核`, latest?.decision === 'verified' ? 'verified' : latest?.decision === 'rejected' ? 'invalid' : 'unverified', latest?.decision === 'verified' ? '管理员已对这个确切版本记录审核通过。' : latest?.decision === 'rejected' ? '管理员已否决这个确切版本。' : '这个确切版本尚无管理员审核通过记录。', evidence);
      }
      // The fingerprint binds the saved metadata to its dependencies; bytes are checked above on each run.
      return { readiness: { productRevision: item.revision, dependencyFingerprint: hash({ product: item, company: lib.company, dependencies, checks }), asOf: time, policyVersion: 'library-v1', overall: checks.some(entry => ['missing', 'invalid', 'expired'].includes(entry.status)) ? 'incomplete' : checks.some(entry => entry.status === 'unverified') ? 'needs_review' : 'ready_for_review', checks } };
    },
  };
}
