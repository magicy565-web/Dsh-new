// Data validation only. Writing and tool selection belong to the official model
// AgentSession; this module generates no quotation, sample or follow-up body.
import { createHash } from 'node:crypto';
export const factoryInquiryHash = value => createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
  return value;
}
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const exact = (v, fields) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => fields.includes(k));
export function validateInquiryDrafts(input) {
  if (!exact(input, ['inquiryDocumentId', 'documentVersion', 'productId', 'sources', 'documents', 'requestId'])
    || !uuid(input.inquiryDocumentId) || !uuid(input.productId) || !Number.isInteger(input.documentVersion) || input.documentVersion < 1 || input.documentVersion > 100
    || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input.requestId || '')
    || !Array.isArray(input.sources) || input.sources.length !== 2 || Buffer.byteLength(JSON.stringify(input.sources)) > 6000
    || !Array.isArray(input.documents) || input.documents.length < 1 || input.documents.length > 5)
    throw Error('Use exact original inquiry/product selectors, original source references, a stable requestId and one to five unreviewed Markdown drafts.');
  const names = new Set(); let bytes = 0;
  for (const doc of input.documents) {
    if (!exact(doc, ['name', 'content']) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}\.md$/.test(doc.name || '') || doc.name.includes('..')
      || names.has(doc.name) || typeof doc.content !== 'string' || !doc.content.trim() || doc.content.includes('\0') || (bytes += Buffer.byteLength(doc.content)) > 60000)
      throw Error('Use unique safe Markdown filenames and bounded nonempty draft text. No approval or sending fields are accepted.');
    names.add(doc.name);
  }
  return structuredClone(input);
}
