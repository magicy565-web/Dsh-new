// Business DTO constraints only. The official SDK owns tool-schema validation;
// direct Host callers must pass the same selectors before any disclosure.
export const FACTORY_MATERIAL_INPUTS = Object.freeze({
  status: { type: 'object', properties: {}, required: [], additionalProperties: false },
  materials: { type: 'object', properties: {
    productId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![\\s\\S])' },
    limit: { type: 'integer', minimum: 1, maximum: 20 },
  }, required: [], additionalProperties: false },
  document: { type: 'object', properties: {
    documentId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![\\s\\S])' },
    documentVersion: { type: 'integer', minimum: 1, maximum: 100 },
  }, required: ['documentId', 'documentVersion'], additionalProperties: false },
});
export function validateFactoryMaterialInput(method, input) {
  const schema = FACTORY_MATERIAL_INPUTS[method];
  if (!schema || !input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !Object.hasOwn(schema.properties, key))
    || schema.required.some(key => !Object.hasOwn(input, key))) throw new TypeError('Invalid factory material selectors.');
  for (const [key, value] of Object.entries(input)) {
    const rule = schema.properties[key];
    if (rule.type === 'string' ? typeof value !== 'string' || !new RegExp(rule.pattern).test(value)
      : !Number.isInteger(value) || value < rule.minimum || value > rule.maximum) throw new TypeError('Invalid factory material selectors.');
  }
  return structuredClone(input);
}
