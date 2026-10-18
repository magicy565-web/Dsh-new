// References to the ORIGINAL Library only. No copied business facts, file
// bodies, new grants, remote transport, model access or Medusa identity mapping.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const sha = /^[a-f0-9]{64}$/u;
const positive = value => Number.isSafeInteger(value) && value > 0;
const keys = row => row.kind === 'product' ? ['kind', 'id', 'revision'] : row.kind === 'medusa-product' ? ['kind', 'id', 'revision', 'sourceId', 'sourceHash'] : ['kind', 'id', 'revision', 'documentVersion', 'asset'];
export function validateSpaceSources(sources, fail) {
  if (!Array.isArray(sources) || sources.length > 30) fail(400, 'SPACE_SOURCE_INPUT', 'Select at most 30 original Library sources.');
  const seen = new Set();
  for (const row of sources) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !['product', 'document', 'medusa-product'].includes(row.kind) || Object.keys(row).length !== keys(row).length || Object.keys(row).some(key => !keys(row).includes(key)) || !(row.kind === 'medusa-product' ? typeof row.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(row.id) : uuid.test(row.id)) || !positive(row.revision)) fail(400, 'SPACE_SOURCE_INPUT', 'Use an exact original Library source reference.');
    const key = row.kind + ':' + row.id;
    if (row.kind === 'medusa-product' && (!uuid.test(row.sourceId) || row.revision > 2147483647 || typeof row.sourceHash !== 'string' || !/^(?:[a-f0-9]{64}|rev:[a-f0-9]{32}:[a-f0-9]{64})$/u.test(row.sourceHash))) fail(400, 'SPACE_SOURCE_INPUT', 'Pin the reviewed Medusa source binding, review version and approval fingerprint.');
    if (seen.has(key)) fail(400, 'SPACE_SOURCE_INPUT', 'A source may be selected only once.');
    seen.add(key);
    if (row.kind === 'document') {
      const asset = row.asset;
      if (!positive(row.documentVersion) || row.documentVersion > 100 || !asset || Object.keys(asset).sort().join(',') !== 'artifactId,sha256,version' || !uuid.test(asset.artifactId) || !positive(asset.version) || !sha.test(asset.sha256)) fail(400, 'SPACE_SOURCE_INPUT', 'Pin the original document version and exact Artifact manifest.');
    }
  }
  if (sources.filter(row => row.kind === 'medusa-product').length > 8) fail(400, 'SPACE_SOURCE_INPUT', 'Select at most eight remote Medusa sources.');
  return sources;
}
const itemFor = (state, ref) => state.businessLibrary?.[ref.kind === 'product' ? 'products' : 'documents']?.find(item => item.id === ref.id);
function intact(state, ref, item) {
  if (ref.kind === 'product') return true;
  const version = item.versions.find(row => row.version === ref.documentVersion);
  const asset = version?.asset;
  if (!asset || asset.artifactId !== ref.asset.artifactId || asset.version !== ref.asset.version || asset.sha256 !== ref.asset.sha256) return false;
  const record = state.artifacts?.find(row => row.id === asset.artifactId);
  return record?.versions.some(row => row.version === asset.version && row.sha256 === asset.sha256) === true;
}
export function resolveSpaceSources(state, sources) {
  return sources.map(reference => {
    if (reference.kind === 'medusa-product') return { reference: structuredClone(reference), status: 'unchecked' };
    const item = itemFor(state, reference);
    const status = !item ? 'missing' : item.status === 'archived' ? 'archived' : !intact(state, reference, item) ? 'unavailable' : item.revision !== reference.revision || reference.kind === 'document' && item.currentVersion !== reference.documentVersion ? 'updated' : 'current';
    // A stale pin never silently becomes a link to new content or exposes its title.
    return { reference: structuredClone(reference), status, ...(status === 'current' ? {
      title: item.name ?? item.title, referenceOnly: item.source?.referenceOnly === true,
      libraryPath: `${reference.kind === 'product' ? 'products' : 'company/documents'}/${reference.id}`,
    } : {}) };
  });
}
export function requireCurrentSpaceSources(state, sources, fail) {
  validateSpaceSources(sources, fail);
  if (resolveSpaceSources(state, sources.filter(row => row.kind !== 'medusa-product')).some(row => row.status !== 'current')) fail(409, 'SPACE_SOURCE_CHANGED', 'A selected source changed or is unavailable. Reload sources before saving.');
  return structuredClone(sources);
}
export function spaceSourceCatalog(state, { kind, q = '', offset = '0' } = {}, fail) {
  if (!['product', 'document'].includes(kind) || typeof q !== 'string' || Buffer.byteLength(q) > 200 || !/^(0|[1-9][0-9]{0,3})$/u.test(offset)) fail(400, 'SPACE_SOURCE_QUERY', 'Choose product or document with a bounded search and offset.');
  const search = q.trim().toLocaleLowerCase();
  const items = (state.businessLibrary?.[kind === 'product' ? 'products' : 'documents'] ?? [])
    .filter(item => item.status !== 'archived' && (item.name ?? item.title).toLocaleLowerCase().includes(search))
    .sort((a, b) => a.id.localeCompare(b.id)).flatMap(item => {
      const version = kind === 'document' ? item.versions.find(row => row.version === item.currentVersion) : null;
      const reference = { kind, id: item.id, revision: item.revision, ...(kind === 'document' ? { documentVersion: item.currentVersion, asset: version?.asset } : {}) };
      return intact(state, reference, item) ? [{ reference, title: item.name ?? item.title, referenceOnly: item.source?.referenceOnly === true }] : [];
    });
  const start = Number(offset), end = start + 20;
  return { items: items.slice(start, end), nextOffset: end < items.length ? String(end) : null, source: 'original-workspace-library', fileVerification: 'manifest-only', modelAccess: false };
}
