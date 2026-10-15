import { libraryReadHash, normalizeLibraryRecipient, libraryRecipientForModel } from './library-model-read-contract.mjs';
import { looksLikeCredential } from './public-input.mjs';
const API = '/api/library/model-read/factory';
const FIELDS = ['name', 'description', 'category', 'status', 'skuSpecifications', 'capacityNote', 'documentReferences', 'provenance'];
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => keys.includes(k));
const positive = v => Number.isSafeInteger(v) && v > 0;
const text = v => typeof v === 'string' && v.length <= 100000;
const gap = reason => ({ plugin: 'workspace-factory-materials', status: 'blocked', reason, sources: [] });
const invalid = () => { throw new Error('Factory material receipt does not match the exact original Library projection.'); };
function provenance(v) {
  if (!exact(v, ['kind', 'referenceOnly', 'sourceUrl', 'fetchedAt', 'batchId', 'fieldSources'])) return false;
  // Original Library provenance is an inert citation, never authority or a tool URL.
  return ['user_provided', 'public_reference'].includes(v.kind) && typeof v.referenceOnly === 'boolean' && Array.isArray(v.fieldSources)
    && v.fieldSources.length <= 200 && v.fieldSources.every(f => exact(f, ['fieldPath', 'sourceUrl', 'locator', 'capturedValue']) && Object.values(f).every(text))
    && !looksLikeCredential(JSON.stringify(v));
}
function product(v) {
  if (!exact(v, ['id', 'revision', ...FIELDS]) || !uuid(v.id) || !positive(v.revision)) return false;
  for (const field of ['name', 'description', 'category', 'status', 'capacityNote']) if (v[field] !== undefined && !text(v[field])) return false;
  if (v.provenance !== undefined && !provenance(v.provenance)) return false;
  if (v.skuSpecifications !== undefined && (!Array.isArray(v.skuSpecifications) || v.skuSpecifications.length > 100 || v.skuSpecifications.some(s =>
    !exact(s, ['id', 'code', 'specs', 'unit', 'moq', 'leadTimeDays']) || !uuid(s.id) || !text(s.code) || !text(s.unit)
    || s.moq !== null && !positive(s.moq) || s.leadTimeDays !== null && (!Number.isSafeInteger(s.leadTimeDays) || s.leadTimeDays < 0)
    || !Array.isArray(s.specs) || s.specs.length > 30 || s.specs.some(p => !exact(p, ['key', 'value']) || !text(p.key) || !text(p.value))))) return false;
  if (v.documentReferences !== undefined && (!Array.isArray(v.documentReferences) || v.documentReferences.length > 50 || v.documentReferences.some(d =>
    !exact(d, ['documentId', 'documentVersion', 'purpose']) || !uuid(d.documentId) || !positive(d.documentVersion) || !text(d.purpose)))) return false;
  return true;
}
function document(v) {
  if (!exact(v, ['id', 'revision', 'documentVersion', 'asset', 'title', 'slotKey', 'provenance', 'certificate', 'internalReview', 'independentVerification', 'validity',
    'status', 'format', 'text', 'extractionPolicy', 'reason', 'textTruncated', 'pagesNeedingOcr', 'ocrStatus', 'notice'])
    || !uuid(v.id) || !positive(v.revision) || !positive(v.documentVersion) || !exact(v.asset, ['artifactId', 'version', 'sha256'])
    || !uuid(v.asset.artifactId) || !positive(v.asset.version) || !/^[a-f0-9]{64}$/.test(v.asset.sha256 || '')
    || !text(v.title) || !['company', 'license', 'certificate', 'test_report', 'specification', 'supply_policy', 'other'].includes(v.slotKey)
    || !provenance(v.provenance) || !exact(v.certificate, ['number', 'issuer', 'scope', 'validFrom', 'validUntil', 'expiryMode', 'expiryNote'])
    || Object.entries(v.certificate).some(([k, x]) => !text(x) && !(['validFrom', 'validUntil'].includes(k) && x === null)) || !['unreviewed', 'verified', 'rejected'].includes(v.internalReview)
    || v.independentVerification !== false || !['unknown', 'expired', 'not_yet_valid', 'recorded_current'].includes(v.validity)
    || !['available', 'partial', 'blocked'].includes(v.status) || !text(v.text) || typeof v.textTruncated !== 'boolean'
    || v.pagesNeedingOcr !== null && (!Array.isArray(v.pagesNeedingOcr) || v.pagesNeedingOcr.some(p => !positive(p)))
    || !['not_performed', 'not_applicable', 'native_hint_only', 'unknown_after_truncation'].includes(v.ocrStatus)
    || v.extractionPolicy !== 'original-library-native-text-hints-v1') return false;
  if (v.status === 'blocked' && v.text !== '' || v.textTruncated && (v.status !== 'partial' || v.pagesNeedingOcr !== null || v.ocrStatus !== 'unknown_after_truncation')) return false;
  return true;
}
// The caller injects only the existing Session request closure. No credentials,
// login, permission producer, path/URL selector or storage is part of this client.
export function createWorkspaceFactoryMaterialsClient({ request, recipient }) {
  if (typeof request !== 'function') throw TypeError('Use the original Session transport.');
  const receiver = normalizeLibraryRecipient(recipient), receiverHash = libraryReadHash(receiver);
  const matchesModel = model => { try { return libraryReadHash(libraryRecipientForModel(model)) === receiverHash; } catch { return false; } };
  async function read(suffix, signal, model) {
    if (!matchesModel(model)) return gap('FACTORY_MATERIAL_RECIPIENT_CHANGED');
    const response = await request(API + suffix, { method: 'GET', redirect: 'error', signal,
      headers: { Accept: 'application/json', 'X-Workspace-Library-Recipient': receiverHash } });
    if (!response?.ok) { if ([401, 403, 404, 409].includes(response?.status)) return gap('FACTORY_MATERIAL_SESSION_REFUSED_HTTP_' + response.status); invalid(); }
    if (response.redirected || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) invalid();
    const reader = response.body?.getReader(); if (!reader) invalid();
    let bytes = 0, chunks = [];
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > 512000) { await reader.cancel(); invalid(); } chunks.push(chunk.value); }
    } finally { reader.releaseLock(); }
    let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { invalid(); }
    if (value?.plugin !== 'workspace-factory-materials' || looksLikeCredential(JSON.stringify(value))) invalid();
    if (value.status === 'unconfigured') return { plugin: value.plugin, status: 'unconfigured', reason: 'FACTORY_MATERIAL_DISCLOSURE_NOT_CONFIGURED', sources: [] };
    const a = value.authorization;
    if (!['available', 'empty', 'partial', 'blocked'].includes(value.status) || !exact(a, ['scopeFingerprint', 'recipient', 'workspaceId', 'subject', 'expiresAt'])
      || !/^[a-f0-9]{64}$/.test(a.scopeFingerprint || '') || !text(a.workspaceId) || !a.workspaceId || !text(a.subject) || !a.subject
      || !Number.isFinite(Date.parse(a.expiresAt)) || Date.now() >= Date.parse(a.expiresAt)
      || libraryReadHash(normalizeLibraryRecipient(a.recipient)) !== receiverHash || !Array.isArray(value.sources)) invalid();
    if (suffix === '/status') {
      if (!exact(value, ['plugin', 'status', 'authorization', 'sources', 'fields', 'extractionPolicy']) || value.status !== 'available' || value.sources.length
        || !Array.isArray(value.fields) || value.fields.some(f => !FIELDS.includes(f)) || value.extractionPolicy !== 'original-library-native-text-hints-v1') invalid();
      return value;
    }
    const isDocument = suffix.startsWith('/documents/'), rows = isDocument ? [value.document] : value.products;
    if (!exact(value, ['plugin', 'status', 'authorization', 'sources', ...(isDocument ? ['document'] : ['products', 'selection', 'limit', 'hasMore', 'productId'])])) invalid();
    if (!Array.isArray(rows) || rows.length > 20 || rows.length !== value.sources.length) invalid();
    rows.forEach((row, i) => {
      if (!(isDocument ? document(row) : product(row))) invalid();
      const source = value.sources[i], api = API + (isDocument ? '/documents/' + row.id + '/' + row.documentVersion : '/materials?productId=' + row.id);
      if (!exact(source, ['kind', 'recordId', 'revision', 'workspaceId', 'projectionSha256', 'api', ...(isDocument ? ['documentVersion', 'artifactId', 'version', 'sha256'] : [])])
        || source.kind !== (isDocument ? 'factory-document' : 'factory-product') || source.recordId !== row.id || source.revision !== row.revision || source.workspaceId !== a.workspaceId
        || source.projectionSha256 !== libraryReadHash(row) || source.api !== api
        || isDocument && (source.documentVersion !== row.documentVersion || source.artifactId !== row.asset.artifactId || source.version !== row.asset.version || source.sha256 !== row.asset.sha256)) invalid();
    });
    if (isDocument) { if (suffix !== '/documents/' + value.document.id + '/' + value.document.documentVersion || value.status !== value.document.status) invalid(); }
    else {
      const q = new URLSearchParams(suffix.split('?')[1]), expectedLimit = Number(q.get('limit') || 20);
      if (value.status !== (rows.length ? 'available' : 'empty') || value.limit !== expectedLimit || typeof value.hasMore !== 'boolean'
        || value.selection !== 'approved-exact-revisions-only' || rows.length > expectedLimit
        || q.has('productId') && (rows.length !== 1 || rows[0].id !== q.get('productId') || value.productId !== rows[0].id)) invalid();
    }
    return value;
  }
  const status = (signal, model) => read('/status', signal, model);
  const materials = (input = {}, signal, model) => {
    if (!exact(input, ['productId', 'limit']) || input.productId !== undefined && !uuid(input.productId)
      || input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20)) throw Error('Use only exact productId or a limit from 1 to 20.');
    return read('/materials?' + (input.productId ? 'productId=' + input.productId + (input.limit === undefined ? '' : '&limit=' + input.limit) : 'limit=' + (input.limit ?? 20)), signal, model);
  };
  const documentRead = (input, signal, model) => {
    if (!exact(input, ['documentId', 'documentVersion']) || !uuid(input.documentId) || !positive(input.documentVersion) || input.documentVersion > 100) throw Error('Use the exact document UUID/version.');
    return read('/documents/' + input.documentId + '/' + input.documentVersion, signal, model);
  };
  async function revalidateReceipt(receipt, model, signal) {
    const current = await status(signal, model);
    if (current.status !== 'available' || libraryReadHash(current.authorization) !== libraryReadHash(receipt.authorization)) throw Error('Factory cached receipt authorization changed.');
    const fresh = receipt.document ? await documentRead({ documentId: receipt.document.id, documentVersion: receipt.document.documentVersion }, signal, model)
      : receipt.fields ? current : await materials(receipt.productId ? { productId: receipt.productId, limit: receipt.limit } : { limit: receipt.limit }, signal, model);
    if (!['available', 'empty', 'partial', 'blocked'].includes(fresh.status) || !fresh.authorization || libraryReadHash(fresh) !== libraryReadHash(receipt)) throw Error('Factory cached receipt source, version or extraction policy changed.');
  }
  return Object.freeze({ status, materials, document: documentRead, matchesModel, revalidateReceipt });
}
