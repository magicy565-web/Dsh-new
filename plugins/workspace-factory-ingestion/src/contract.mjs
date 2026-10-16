// Data admission only. The original host owns permissions, reading and storage.
export const INGESTION_PLUGIN = 'workspace-factory-ingestion';
export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
export const SHA = /^[a-f0-9]{64}$/u;
export function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some(k => !keys.includes(k))) throw Error('Use only documented intake fields.');
}
export function bounded(value, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw Error('Use bounded explicit text.');
  return value;
}
export function asset(value) {
  exact(value, ['artifactId', 'version', 'sha256']);
  if (!UUID.test(value.artifactId) || !Number.isSafeInteger(value.version) || value.version < 1 || value.version > 100 || !SHA.test(value.sha256)) throw Error('An exact original file version is required.');
  return value;
}
export function leaves(value, prefix = '') {
  if (value === null || typeof value !== 'object') return [[prefix, value]];
  return Object.entries(value).flatMap(([key, item]) => leaves(item, prefix ? `${prefix}.${key}` : key));
}
const values = {
  company: ['legalName', 'displayName', 'description', 'capabilities', 'certificates', 'oem', 'odm', 'dropshipping'],
  product: ['name', 'description', 'category', 'skus', 'images', 'supply', 'oem', 'odm', 'dropshipping', 'capabilities', 'certificates'],
  document: ['title', 'slotKey', 'certificate'],
};
export function validateIntake(input) {
  exact(input, ['requestId', 'sources', 'records']); bounded(input.requestId, 128);
  const encoded = JSON.stringify(input);
  if (Buffer.byteLength(encoded) > 60000) throw Error('Intake exceeds 60000 bytes.');
  // Reject unsafe/deep/non-JSON values rather than silently changing a journal.
  const walk = (v, depth = 0) => {
    if (depth > 15 || v === undefined || typeof v === 'number' && !Number.isFinite(v)) throw Error('Use bounded JSON.');
    if (v && typeof v === 'object') {
      if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw Error('Use plain JSON.');
      for (const [k, child] of Object.entries(v)) { if (['__proto__', 'prototype', 'constructor'].includes(k)) throw Error('Unsafe JSON key.'); walk(child, depth + 1); }
    } else if (!['string', 'number', 'boolean'].includes(typeof v) && v !== null) throw Error('Use JSON.');
  }; walk(input);
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > 20) throw Error('Select 1–20 original read receipts.');
  for (const source of input.sources) {
    exact(source, ['asset', 'readHash']); asset(source.asset); if (!SHA.test(source.readHash)) throw Error('Preserve the original read hash.');
  }
  if (new Set(input.sources.map(s => `${s.asset.artifactId}/${s.asset.version}`)).size !== input.sources.length) throw Error('Duplicate source selectors.');
  if (!Array.isArray(input.records) || input.records.length > 40) throw Error('Use at most 40 records.');
  const keys = new Set();
  for (const row of input.records) {
    exact(row, ['key', 'kind', 'recordId', 'expectedRevision', 'sourceIndex', 'values', 'evidence', 'missing', 'conflicts']);
    bounded(row.key, 100); if (keys.has(row.key) || row.key === 'report' || row.key.startsWith('source:')) throw Error('Record keys must be unique and avoid reserved source/report keys.'); keys.add(row.key);
    if (!Object.hasOwn(values, row.kind)) throw Error('Use company, product or document.'); exact(row.values, values[row.kind]);
    if (row.recordId !== undefined && (row.kind !== 'product' || !UUID.test(row.recordId) || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 1)) throw Error('Pin an original product revision.');
    if (row.recordId === undefined && row.expectedRevision !== undefined) throw Error('Revision requires a product id.');
    if (row.kind === 'document' ? !Number.isSafeInteger(row.sourceIndex) || !input.sources[row.sourceIndex] : row.sourceIndex !== undefined) throw Error('Document classification requires its source index.');
    if (!Array.isArray(row.missing) || row.missing.length > 100 || !Array.isArray(row.conflicts) || row.conflicts.length > 100) throw Error('Record missing/conflict arrays explicitly.');
    for (const note of [...row.missing, ...row.conflicts]) bounded(note, 1000);
    if (!Array.isArray(row.evidence) || row.evidence.length > 1000) throw Error('Supply field evidence.');
    const paths = leaves(row.values).filter(([, v]) => v !== null && v !== '').map(([p]) => p);
    for (const e of row.evidence) {
      exact(e, ['path', 'sourceIndex', 'start', 'end', 'quote', 'observation']); bounded(e.path, 200);
      if (!paths.includes(e.path) || !Number.isSafeInteger(e.sourceIndex) || !input.sources[e.sourceIndex]) throw Error('Evidence must select a proposed field and original source.');
      if (e.observation !== undefined) {
        if (e.observation !== 'image-unverified' || e.start !== undefined || e.end !== undefined || e.quote !== undefined) throw Error('Visual observations are unverified.');
      } else if (!Number.isSafeInteger(e.start) || e.start < 0 || !Number.isSafeInteger(e.end) || e.end <= e.start || e.end - e.start > 4000 || bounded(e.quote) !== e.quote || e.quote.length !== e.end - e.start) throw Error('Quote exact UTF-16 source offsets.');
    }
    if (paths.some(p => !row.evidence.some(e => e.path === p))) throw Error('Every populated leaf requires original evidence.');
    if (row.kind === 'product') {
      if (row.values.skus !== undefined) {
        if (!Array.isArray(row.values.skus) || row.values.skus.length > 100) throw Error('Use at most 100 SKUs.');
        for (const sku of row.values.skus) { exact(sku, ['code', 'specs', 'unit', 'moq', 'leadTimeDays']); bounded(sku.code, 100); }
        if (new Set(row.values.skus.map(s => s.code.toLowerCase())).size !== row.values.skus.length) throw Error('Duplicate SKU.');
      }
      if (row.values.supply !== undefined) exact(row.values.supply, ['packaging', 'samplePolicy', 'paymentTerms', 'shippingTerms', 'capacityNote']);
      if (row.values.images !== undefined) {
        if (!Array.isArray(row.values.images) || row.values.images.length > 10) throw Error('Use at most ten images.');
        for (const image of row.values.images) { exact(image, ['asset', 'alt']); asset(image.asset); }
      }
    }
  }
  if (input.records.filter(r => r.kind === 'company').length > 1 || new Set(input.records.filter(r => r.kind === 'document').map(r => r.sourceIndex)).size !== input.records.filter(r => r.kind === 'document').length) throw Error('Duplicate company/document classification.');
  return structuredClone(input);
}
