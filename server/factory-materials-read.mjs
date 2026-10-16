// Read-only projection of original Library records. The parent Library policy
// owns authorization; no store, credential, approval or queue is added here.
import { ApiError } from './runtime.mjs';
import { looksLikeCredential } from './security.mjs';
import { libraryReadHash } from './library-model-read-contract.mjs';
import { extractFactoryDocument } from './factory-document-extract.mjs';

export const FACTORY_FIELDS = Object.freeze(['name', 'description', 'category', 'status', 'skuSpecifications', 'capacityNote', 'documentReferences', 'provenance', 'images']);
const fail = (status, code) => { throw new ApiError(status, code, 'The exact reviewed factory material is unavailable; review its original Library record and version.'); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => keys.includes(k));
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const positive = v => Number.isSafeInteger(v) && v > 0;
export function validateFactoryMaterialsPolicy(value) {
  if (value === undefined) return;
  if (!exact(value, ['products', 'productFields', 'documents']) || !Array.isArray(value.products) || value.products.length > 100
    || !Array.isArray(value.productFields) || !value.productFields.length || new Set(value.productFields).size !== value.productFields.length
    || value.productFields.some(f => !FACTORY_FIELDS.includes(f)) || new Set(value.products.map(p => p?.id)).size !== value.products.length
    || value.products.some(p => !exact(p, ['id', 'revision']) || !uuid(p.id) || !positive(p.revision))
    || !Array.isArray(value.documents) || value.documents.length > 100 || new Set(value.documents.map(d => d?.id)).size !== value.documents.length
    || value.documents.some(d => !exact(d, ['id', 'revision', 'documentVersion', 'asset']) || !uuid(d.id) || !positive(d.revision)
      || !positive(d.documentVersion) || d.documentVersion > 100 || !exact(d.asset, ['artifactId', 'version', 'sha256'])
      || !uuid(d.asset.artifactId) || !positive(d.asset.version) || !/^[a-f0-9]{64}$/.test(d.asset.sha256 || '')))
    throw new TypeError('Factory material disclosure requires explicit fields, exact product revisions and exact document/asset versions and hashes.');
}
export function createFactoryMaterialsRead({ library, artifacts, scope, authorization, clock }) {
  const policy = scope?.factoryMaterials;
  const base = () => ({ plugin: 'workspace-factory-materials', authorization, sources: [] });
  const safe = value => { if (looksLikeCredential(JSON.stringify(value))) fail(403, 'FACTORY_MATERIAL_UNSAFE'); return value; };
  function product(ref) {
    const row = library.getProduct(ref.id).product;
    if (row.revision !== ref.revision || row.status === 'archived') fail(409, 'FACTORY_PRODUCT_REVISION_CHANGED');
    const values = { name: row.name, description: row.description, category: row.category, status: row.status,
      skuSpecifications: row.skus.map(({ id, code, specs, unit, moq, leadTimeDays }) => ({ id, code, specs, unit, moq, leadTimeDays })),
      images: row.images, capacityNote: row.supply.capacityNote, documentReferences: row.documents.filter(d => policy.documents.some(pin => pin.id === d.documentId && pin.documentVersion === d.documentVersion))
        .map(({ documentId, documentVersion, purpose }) => ({ documentId, documentVersion, purpose })), provenance: row.source };
    const value = safe({ id: row.id, revision: row.revision, ...Object.fromEntries(policy.productFields.map(field => [field, values[field]])) });
    return { value, source: { kind: 'factory-product', recordId: row.id, revision: row.revision, workspaceId: scope.workspaceId,
      projectionSha256: libraryReadHash(value), api: '/api/library/model-read/factory/materials?productId=' + row.id } };
  }
  function documentRef(id, version) {
    const ref = policy.documents.find(d => d.id === id && d.documentVersion === version);
    if (!ref) fail(404, 'FACTORY_DOCUMENT_NOT_APPROVED');
    const row = library.getDocument(id).document;
    if (row.revision !== ref.revision || row.currentVersion !== version || row.status !== 'active') fail(409, 'FACTORY_DOCUMENT_REVISION_CHANGED');
    const selected = row.versions.find(v => v.version === version);
    if (!selected || libraryReadHash(selected.asset) !== libraryReadHash(ref.asset)) fail(409, 'FACTORY_DOCUMENT_ASSET_CHANGED');
    return { ref, row, selected };
  }
  return { source(asset) {
    const pin=policy?.documents.find(ref=>libraryReadHash(ref.asset)===libraryReadHash(asset));
    if(!pin)fail(403,'FACTORY_DOCUMENT_NOT_APPROVED');
    const {row,selected}=documentRef(pin.id,pin.documentVersion);
    return {documentId:row.id,revision:row.revision,documentVersion:selected.version,asset:structuredClone(pin.asset)};
  }, async read(suffix, query = new URLSearchParams(), { signal, assertCurrent }) {
    assertCurrent(); signal?.throwIfAborted();
    if (!policy) return { plugin: 'workspace-factory-materials', status: 'unconfigured', reason: 'FACTORY_MATERIAL_DISCLOSURE_NOT_CONFIGURED', sources: [] };
    if ([...query.keys()].some(k => !(['materials'].includes(suffix) ? ['productId', 'limit'] : []).includes(k) || query.getAll(k).length !== 1)) fail(400, 'FACTORY_MATERIAL_INPUT_INVALID');
    if (suffix === 'status') return { ...base(), status: 'available', fields: [...policy.productFields], extractionPolicy: 'original-library-native-text-hints-v1' };
    if (suffix === 'materials') {
      const id = query.get('productId'), raw = query.get('limit') ?? '20';
      if (!/^(?:[1-9]|1[0-9]|20)$/.test(raw) || query.has('productId') && !uuid(id)) fail(400, 'FACTORY_MATERIAL_INPUT_INVALID');
      const refs = id ? policy.products.filter(p => p.id === id) : policy.products.slice(0, Number(raw));
      if (id && !refs.length) fail(404, 'FACTORY_PRODUCT_NOT_APPROVED');
      const rows = refs.map(product); assertCurrent();
      return { ...base(), status: rows.length ? 'available' : 'empty', products: rows.map(r => r.value), sources: rows.map(r => r.source),
        selection: 'approved-exact-revisions-only', limit: Number(raw), hasMore: !id && policy.products.length > Number(raw), ...(id ? { productId: id } : {}) };
    }
    const match = suffix.match(/^documents\/([a-f0-9-]{36})\/([1-9][0-9]?|100)$/);
    if (!match) fail(404, 'FACTORY_MATERIAL_NOT_FOUND');
    const { ref, row, selected } = documentRef(match[1], Number(match[2]));
    const file = await artifacts.download(ref.asset.artifactId, { version: ref.asset.version });
    if (file.version.sha256 !== ref.asset.sha256) fail(409, 'FACTORY_DOCUMENT_ASSET_CHANGED');
    assertCurrent(); signal?.throwIfAborted();
    const extracted = await extractFactoryDocument({ bytes: file.bytes, mimeType: file.mimeType, signal });
    assertCurrent(); signal?.throwIfAborted(); documentRef(match[1], Number(match[2]));
    const latestReview = row.reviews.filter(r => r.documentVersion === selected.version && r.sha256 === ref.asset.sha256).at(-1);
    const cert = selected.certificate, today = new Date(clock()).toISOString().slice(0, 10);
    const document = safe({ id: row.id, revision: row.revision, documentVersion: selected.version, asset: ref.asset,
      title: row.title, slotKey: row.slotKey, provenance: row.source, certificate: cert,
      internalReview: latestReview?.decision || 'unreviewed', independentVerification: false,
      validity: cert.expiryMode === 'unknown' ? 'unknown' : cert.validFrom && cert.validFrom > today ? 'not_yet_valid'
        : cert.expiryMode === 'dated' && cert.validUntil < today ? 'expired' : 'recorded_current', ...extracted });
    return { ...base(), status: extracted.status, document, sources: [{ kind: 'factory-document', recordId: row.id, revision: row.revision,
      documentVersion: selected.version, ...ref.asset, workspaceId: scope.workspaceId, projectionSha256: libraryReadHash(document),
      api: '/api/library/model-read/factory/' + suffix }] };
  } };
}
