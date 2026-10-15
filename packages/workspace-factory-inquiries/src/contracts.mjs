const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![\\s\\S])' };
const positive = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}(?![\\s\\S])' };
const text = maxLength => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S', not: { pattern: '\u0000' } });
const common = { workspaceId: text(1000), recordId: uuid, revision: positive, projectionSha256: hash };
const documentSource = object({ kind: { type: 'string', const: 'factory-document' }, ...common,
  api: { type: 'string', pattern: '^/api/library/model-read/factory/documents/[a-f0-9-]{36}/(?:[1-9][0-9]?|100)(?![\\s\\S])' },
  documentVersion: { ...positive, maximum: 100 }, artifactId: uuid, version: positive, sha256: hash });
const productSource = object({ kind: { type: 'string', const: 'factory-product' }, ...common,
  api: { type: 'string', pattern: '^/api/library/model-read/factory/materials\\?productId=[a-f0-9-]{36}(?![\\s\\S])' } });
export const FACTORY_INQUIRY_INPUT = object({
  inquiryDocumentId: uuid, documentVersion: { ...positive, maximum: 100 }, productId: uuid,
  sources: { type: 'array', minItems: 2, maxItems: 2, uniqueItems: true, items: { anyOf: [documentSource, productSource] } },
  documents: { type: 'array', minItems: 1, maxItems: 5, items: object({
    name: { type: 'string', minLength: 4, maxLength: 83, pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\\.md(?![\\s\\S])', not: { pattern: '\\.\\.' } }, content: text(60000),
  }) },
  requestId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}(?![\\s\\S])' },
});
// Fixed business DTO validation, not an alternative schema/extension framework.
const exact = (v, fields) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k));
const matches = (value, rule) => rule.type === 'integer'
  ? Number.isSafeInteger(value) && value >= rule.minimum && value <= rule.maximum
  : typeof value === 'string' && (rule.const === undefined || value === rule.const)
    && (rule.minLength === undefined || [...value].length >= rule.minLength)
    && (rule.maxLength === undefined || [...value].length <= rule.maxLength)
    && (rule.pattern === undefined || new RegExp(rule.pattern).test(value))
    && (!rule.not || !new RegExp(rule.not.pattern).test(value));
export function validateInquiryDrafts(input) {
  const properties = FACTORY_INQUIRY_INPUT.properties;
  if (!exact(input, Object.keys(properties)) || !['inquiryDocumentId', 'documentVersion', 'productId', 'requestId'].every(k => matches(input[k], properties[k]))
    || !Array.isArray(input.sources) || input.sources.length !== 2 || Buffer.byteLength(JSON.stringify(input.sources)) > 6000
    || !Array.isArray(input.documents) || input.documents.length < 1 || input.documents.length > 5)
    throw new TypeError('Use exact original inquiry/product selectors, original sources, a stable requestId and one to five drafts.');
  for (const source of input.sources) {
    const schema = source?.kind === 'factory-document' ? documentSource : productSource;
    if (!exact(source, schema.required) || !Object.entries(schema.properties).every(([k, rule]) => matches(source[k], rule)))
      throw new TypeError('Use complete typed original source references.');
  }
  const doc = input.sources.find(s => s.kind === 'factory-document'), product = input.sources.find(s => s.kind === 'factory-product');
  if (!doc || !product || doc.recordId !== input.inquiryDocumentId || doc.documentVersion !== input.documentVersion
    || product.recordId !== input.productId || doc.workspaceId !== product.workspaceId
    || doc.api !== `/api/library/model-read/factory/documents/${doc.recordId}/${doc.documentVersion}`
    || product.api !== `/api/library/model-read/factory/materials?productId=${product.recordId}`)
    throw new TypeError('Original sources must match the selected inquiry, product and workspace.');
  const names = new Set(); let bytes = 0;
  for (const draft of input.documents) {
    if (!exact(draft, ['name', 'content']) || !Object.entries(properties.documents.items.properties).every(([k, rule]) => matches(draft[k], rule))
      || names.has(draft.name) || (bytes += Buffer.byteLength(draft.content)) > 60000)
      throw new TypeError('Use unique safe Markdown filenames and bounded nonempty draft text.');
    names.add(draft.name);
  }
  // Sources are a set of exact references; normalize their wire order so a
  // model's tool selection order cannot change original Host idempotency.
  return structuredClone({ ...input, sources: [doc, product] });
}
