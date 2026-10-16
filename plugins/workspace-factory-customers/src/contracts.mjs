// Public-only input policy, shared by the extension and original artifact Host.
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const text = maxLength => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S', not: { pattern: '\u0000' } });
export const FACTORY_CUSTOMER_INPUT = object({
  requestId: text(128),
  documents: { type: 'array', minItems: 1, maxItems: 5, items: object({
    name: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*\\.md(?![\\s\\S])' }, content: text(24000),
  }) },
  sourceToolCallIds: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: text(200) },
});
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
function publicText(value, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || [...value].length > maximum
    || /workspace-(?:factory-materials|library)|\b(?:authorization|scopeFingerprint|assets?|artifactId|artifactVersion|documentVersion|sessionFile|recipient|workspaceId|cookie|csrfToken|client_secret|api_key|access_token|refresh_token|password)\b\s*["']?\s*[:=]|\bBearer\s+|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\bAKIA[A-Z0-9]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|file:\/\/|(?:^|[\s"'])(?:\/(?:tmp|home|root|workspace|etc|var)\/|[A-Za-z]:\\)/iu.test(value)) throw new TypeError('Public draft input refused.');
}
export function validateCustomerDrafts(input) {
  if (!exact(input, Object.keys(FACTORY_CUSTOMER_INPUT.properties))) throw new TypeError('Unexpected selectors.');
  publicText(input.requestId, FACTORY_CUSTOMER_INPUT.properties.requestId.maxLength);
  if (!Array.isArray(input.documents) || input.documents.length < 1 || input.documents.length > 5
    || !Array.isArray(input.sourceToolCallIds) || input.sourceToolCallIds.length < 1 || input.sourceToolCallIds.length > 20) throw new TypeError('Bounded documents and references required.');
  for (const document of input.documents) {
    const name = FACTORY_CUSTOMER_INPUT.properties.documents.items.properties.name;
    if (!exact(document, ['name', 'content']) || typeof document.name !== 'string' || document.name.length > name.maxLength
      || !new RegExp(name.pattern).test(document.name)) throw new TypeError('Safe Markdown name required.');
    publicText(document.content, FACTORY_CUSTOMER_INPUT.properties.documents.items.properties.content.maxLength);
  }
  // Cross-document totals and public-disclosure screening are business policy,
  // beyond JSON Schema. UTF-16 total retains the original Host storage bound.
  if (new Set(input.documents.map(row => row.name)).size !== input.documents.length
    || input.documents.reduce((sum, row) => sum + row.content.length, 0) > 60000
    || new Set(input.sourceToolCallIds).size !== input.sourceToolCallIds.length) throw new TypeError('Duplicate or oversized input.');
  for (const id of input.sourceToolCallIds) publicText(id, FACTORY_CUSTOMER_INPUT.properties.sourceToolCallIds.items.maxLength);
  return { requestId: input.requestId, documents: input.documents.map(({ name, content }) => ({ name, content })), sourceToolCallIds: [...input.sourceToolCallIds] };
}
