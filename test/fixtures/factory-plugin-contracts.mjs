// Real upstream schema validators over synthetic DTOs; no model or service.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Compile } from 'typebox/compile';
import { FACTORY_MATERIAL_INPUTS, validateFactoryMaterialInput } from '../../packages/workspace-factory-materials/src/contracts.mjs';
import { FACTORY_CUSTOMER_INPUT, validateCustomerDrafts } from '../../packages/workspace-factory-customers/src/contracts.mjs';
import { FACTORY_INQUIRY_INPUT, validateInquiryDrafts } from '../../packages/workspace-factory-inquiries/src/contracts.mjs';
import { inquiryFixture } from './factory-inquiries-data.mjs';
import { factoryInquiryHash } from '../../packages/workspace-factory-inquiries/src/drafts.mjs';
const engine = process.argv[2];
const check = engine === 'pi' ? (schema, value) => Compile(schema).Check(value)
  : (await import('../../support/omp-coding-agent/node_modules/@oh-my-pi/pi-ai/src/utils/schema/json-schema-validator.ts')).isJsonSchemaValueValid;
const data = inquiryFixture(factoryInquiryHash);
const inquiry = { inquiryDocumentId: data.input.inquiryDocumentId, documentVersion: data.input.documentVersion, productId: data.input.productId,
  sources: [...data.inquiry.sources, ...data.materials.sources], documents: [{ name: 'reply.md', content: 'Please confirm the quantity.' }], requestId: 'stable-request' };
const customer = { requestId: 'stable-request', sourceToolCallIds: ['original-search'], documents: [{ name: 'notes.md', content: 'Public source evidence; fit is pending.' }] };
let checked = 0, policies = 0;
function verify(schema, validate, value, expected, label) {
  assert.equal(check(schema, value), expected, `${engine} raw schema: ${label}`);
  if (expected) assert.deepEqual(validate(value), value, label); else assert.throws(() => validate(value), undefined, label);
  checked++;
}
for (const [method, good, bad] of [
  ['status', {}, [{ field: 'private' }, [], null]],
  ['materials', { productId: data.input.productId, limit: 20 }, [{ productId: '' }, { productId: data.input.productId + '\n' }, { limit: '1' }, { limit: null }, { limit: 0 }, { limit: 21 }, { fields: ['private'] }, { confirmed: true }]],
  ['document', { documentId: data.input.inquiryDocumentId, documentVersion: 2 }, [{ documentId: data.input.inquiryDocumentId }, { documentId: data.input.inquiryDocumentId, documentVersion: 0 }, { documentId: 'bad', documentVersion: 1 }, { documentId: data.input.inquiryDocumentId, documentVersion: 101 }]],
]) {
  verify(FACTORY_MATERIAL_INPUTS[method], value => validateFactoryMaterialInput(method, value), good, true, method);
  for (const value of bad) verify(FACTORY_MATERIAL_INPUTS[method], value => validateFactoryMaterialInput(method, value), value, false, method);
}
verify(FACTORY_CUSTOMER_INPUT, validateCustomerDrafts, customer, true, 'customer');
for (const patch of [{ requestId: ' ' }, { requestId: 42 }, { sourceToolCallIds: ['same', 'same'] }, { sourceToolCallIds: [] }, { confirmed: true },
  { documents: [{ name: 'ok.md\n', content: 'text' }] },
  { documents: [{ name: '../outside.md', content: 'text' }] }, { documents: [{ name: 'ok.md', content: '\0bad' }] },
  { documents: [{ name: 'ok.md', content: '\n\t ' }] }, { documents: [{ name: 'ok.md', content: 'x'.repeat(24001) }] }])
  verify(FACTORY_CUSTOMER_INPUT, validateCustomerDrafts, { ...customer, ...patch }, false, 'customer invalid');
verify(FACTORY_INQUIRY_INPUT, validateInquiryDrafts, inquiry, true, 'inquiry');
for (const patch of [{ requestId: {} }, { requestId: 'bad request id' }, { confirmed: true }, { humanReviewed: true }, { sources: [] },
  { requestId: 'id\n' }, { documents: [{ name: 'ok.md\n', content: 'text' }] },
  { documents: [{ name: 'a..b.md', content: 'text' }] }, { documents: [{ name: 'a.md', content: '\0bad' }] }, { documents: [{ name: 'a.md', content: '  ' }] },
  ...['artifactId', 'sha256', 'documentVersion', 'api'].map(field => { const sources = structuredClone(inquiry.sources); delete sources[0][field]; return { sources }; }),
  { sources: [{ ...inquiry.sources[0], revision: Number.MAX_SAFE_INTEGER + 1 }, inquiry.sources[1]] },
  { sources: [{ ...inquiry.sources[0], humanReviewed: true }, inquiry.sources[1]] },
  { sources: [inquiry.sources[0], { ...inquiry.sources[1], artifactId: data.input.productId }] },
]) verify(FACTORY_INQUIRY_INPUT, validateInquiryDrafts, { ...inquiry, ...patch }, false, 'inquiry invalid');
const reversed = { ...inquiry, sources: [...inquiry.sources].reverse() };
assert.equal(check(FACTORY_INQUIRY_INPUT, reversed), true);
assert.deepEqual(validateInquiryDrafts(reversed), inquiry);
// JSON Schema cannot express aggregate UTF-8 size, distinct filenames, matching
// selectors, or the public-only disclosure policy. Assert these separately.
for (const [schema, validate, value] of [
  [FACTORY_CUSTOMER_INPUT, validateCustomerDrafts, { ...customer, documents: [...customer.documents, ...customer.documents] }],
  [FACTORY_CUSTOMER_INPUT, validateCustomerDrafts, { ...customer, documents: [{ name: 'a.md', content: '/workspace/private/catalog.txt' }] }],
  [FACTORY_CUSTOMER_INPUT, validateCustomerDrafts, { ...customer, documents: [1, 2, 3].map(i => ({ name: `draft-${i}.md`, content: 'x'.repeat(21000) })) }],
  [FACTORY_INQUIRY_INPUT, validateInquiryDrafts, { ...inquiry, documents: [{ name: 'a.md', content: '中'.repeat(20001) }] }],
  [FACTORY_INQUIRY_INPUT, validateInquiryDrafts, { ...inquiry, documents: [...inquiry.documents, ...inquiry.documents] }],
  [FACTORY_INQUIRY_INPUT, validateInquiryDrafts, { ...inquiry, sources: [{ ...inquiry.sources[0], documentVersion: 3 }, inquiry.sources[1]] }],
  [FACTORY_INQUIRY_INPUT, validateInquiryDrafts, { ...inquiry, sources: [inquiry.sources[0], { ...inquiry.sources[1], workspaceId: 'other' }] }],
]) { assert.equal(check(schema, value), true); assert.throws(() => validate(value)); policies++; }
const source = await fs.readFile(new URL('../../packages/workspace-factory-inquiries/src/extension.js', import.meta.url), 'utf8');
assert.ok(source.includes('parameters: FACTORY_INQUIRY_INPUT'));
console.log(JSON.stringify({ engine, upstreamVersion: engine === 'pi' ? '1.1.0' : '18.10.4', rawSchemaCases: checked, businessPolicyCases: policies, modelCalls: 0 }));
