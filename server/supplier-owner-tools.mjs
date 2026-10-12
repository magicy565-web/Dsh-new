import { PUBLIC_LISTING_FIELDS, SUPPLIER_FIELDS, supplierFail, supplierObject } from './supplier-profile.mjs';

const text = { type: 'string', minLength: 1, maxLength: 128 };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const revision = { type: 'integer', minimum: 1 };
const confirmed = { type: 'boolean', const: true };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const asset = object({ artifactId: text, version: revision, sha256: hash });
const image = { oneOf: [object({ kind: { const: 'artifact' }, asset, sourceNote: { type: 'string', minLength: 1, maxLength: 500 } }), object({ kind: { const: 'public_url' }, url: { type: 'string', format: 'uri' }, sourceNote: { type: 'string', minLength: 1, maxLength: 500 } })] };
const facts = object(Object.fromEntries(SUPPLIER_FIELDS.map(field => [field, field === 'images' ? { type: 'array', maxItems: 12, items: image } : /Days$|^(supplierMoq|unitsPerPack)$/.test(field) ? { type: ['integer', 'null'], minimum: /Days$/.test(field) ? 0 : 1 } : { type: ['string', 'null'], maxLength: field === 'description' ? 4000 : 200 }])), []);
const command = (properties, required = Object.keys(properties)) => object({ requestId: text, ...properties }, ['requestId', ...required]);
const publicationCommand = command({ operationId: text, expectedScopeHash: hash, confirmed });
const monitorCommand = command({ monitorId: text, expectedMonitorHash: hash, confirmed });
const definitions = [
  ['get', 'get', null, 'Read this exact private owner supplier record.', true],
  ['intake', 'request', command({ facts, content: { type: 'string', minLength: 1, maxLength: 6000 }, expectedRevision: revision }, []), 'Persist explicit supplier facts; text intake additionally needs original reviewed Pi permission and budget.', false, 'optional'],
  ['profile', 'profile', command({ expectedRevision: revision, facts }), 'Save explicit private facts at the current supplier revision.'],
  ['image_upload', 'image_upload', command({ filename: { type: 'string', maxLength: 160, pattern: '\\.(png|jpg|jpeg|webp)$' }, base64: { type: 'string', maxLength: 1_300_000 }, sourceNote: { type: 'string', minLength: 1, maxLength: 500 } }), 'Save an owner-supplied private image in the original artifact store. No URL fetch or public transfer.', false, 'none'],
  ['preview', 'preview', command({ expectedRevision: revision, confirmed, publicFields: { type: 'array', uniqueItems: true, items: { enum: PUBLIC_LISTING_FIELDS } } }), 'Generate the original retail Listing preview with explicit consumer sale unit and public fields. Unknown URLs remain unknown.'],
  ['save_product', 'saveProduct', command({ expectedRevision: revision, confirmed }), 'Persist or reconcile this original private business-library product; replay the same request ID after response loss.'],
  ['shopify_observation', 'observe', command({ expectedRevision: revision, shopifyProductId: text, publicationId: text, confirmed }, ['expectedRevision', 'shopifyProductId', 'confirmed']), 'Read the exact Shopify product/publication. Required before using its actual publication time as monitor start.'],
  ['publication', 'publication', null, 'Read original Shopify approval, execution, partial and reconciliation status.', true],
  ['publication_review', 'reviewPublication', command({ expectedRevision: revision, expectedPreviewHash: hash, action: { enum: ['draft', 'publish', 'repair_draft'] }, publicationId: text, draftOperationId: text, expectedRemoteContentHash: hash, approveObservedMedia: { type: 'boolean' }, confirmed }, ['expectedRevision', 'expectedPreviewHash', 'action', 'confirmed']), 'Prepare the original exact publication review. This does not approve or execute it.'],
  ['publication_execute', 'executePublication', publicationCommand, 'Execute only the exact already owner-approved original publication. No automatic retry or approval decision.'],
  ['publication_reconcile', 'reconcilePublication', publicationCommand, 'Read back the same original uncertain or partial Shopify operation; never recreate a product.'],
  ['monitors', 'monitors', null, 'Read this service’s original monitoring scopes and nullable observations.', true],
  ['monitor_create', 'createMonitor', command({ expectedRevision: revision, shopifyProductId: text, variantIds: { type: 'array', maxItems: 250, uniqueItems: true, items: text }, startAt: { type: 'string', format: 'date-time' }, startFromPublication: { type: 'boolean' }, confirmed }, ['expectedRevision', 'confirmed']), 'Configure one disabled original seven-day plan. Activation still requires the original manual schedule approval.'],
  ['monitor_check', 'checkMonitor', monitorCommand, 'Perform one manual exact-scope check, preserving partial/unavailable data and original request receipt.'],
  ['monitor_stop', 'stopMonitor', monitorCommand, 'Stop the original exact monitor through the existing service.'],
];

export const SUPPLIER_OWNER_MCP_OPERATIONS = Object.freeze(Object.fromEntries(definitions.map(([operation, method, input, description, readOnly = false, serviceScope = 'required']) => {
  const properties = { ...(serviceScope !== 'none' ? { serviceId: text } : {}), ...(input ? { input } : {}) };
  const required = [...(serviceScope === 'required' ? ['serviceId'] : []), ...(input ? ['input'] : [])];
  return [operation, { method, readOnly, serviceScope, tool: { name: `workspace_supplier_owner_${operation}`, description, inputSchema: object(properties, required), annotations: { readOnlyHint: readOnly, openWorldHint: ['shopify_observation', 'publication_review', 'publication_execute', 'publication_reconcile', 'monitor_check'].includes(operation) } } }];
})));
export const SUPPLIER_OWNER_MCP_TOOLS = Object.freeze(Object.values(SUPPLIER_OWNER_MCP_OPERATIONS).map(item => item.tool));

export function validateSupplierOwnerArguments(operation, args) {
  const definition = SUPPLIER_OWNER_MCP_OPERATIONS[operation];
  if (!Object.hasOwn(SUPPLIER_OWNER_MCP_OPERATIONS, operation)) supplierFail(403, 'SUPPLIER_MCP_OPERATION_FORBIDDEN', 'Only the registered original owner service methods are callable.');
  const schema = definition.tool.inputSchema;
  supplierObject(args, Object.keys(schema.properties));
  if (schema.required.some(field => !Object.hasOwn(args, field)) || args.serviceId !== undefined && (typeof args.serviceId !== 'string' || !args.serviceId || args.serviceId.length > 128)) supplierFail(400, 'SUPPLIER_MCP_ARGUMENTS_INVALID', 'Use the exact registered owner tool arguments.');
  if (schema.properties.input) {
    supplierObject(args.input, Object.keys(schema.properties.input.properties));
    if (schema.properties.input.required.some(field => !Object.hasOwn(args.input, field))) supplierFail(400, 'SUPPLIER_MCP_ARGUMENTS_INVALID', 'Required owner tool input is missing.');
  }
  return definition;
}
