import assert from 'node:assert/strict';
import { Compile } from 'typebox/compile';
import { SHOPIFY_PRODUCT_INPUTS, validateShopifyProductInput } from '../../packages/workspace-shopify-product/src/contracts.mjs';
const engine = process.argv[2], check = engine === 'pi' ? (s, v) => Compile(s).Check(v)
  : (await import('../../support/omp-coding-agent/node_modules/@oh-my-pi/pi-ai/src/utils/schema/json-schema-validator.ts')).isJsonSchemaValueValid;
const id = '11111111-1111-4111-8111-111111111111', hash = 'a'.repeat(64);
const goods = { status: {}, read: { productId: id }, readiness: { productId: id }, image: { productId: id, imageId: id },
  propose: { productId: id, sourceHash: hash, requestId: 'finite', draft: { title: 'Cup', description: 'Original model prose', targetMarket: 'US', currency: 'USD', retailUnit: 'piece', unitsPerPack: 1,
    consumerPrice: '1.25', handlingDays: 1, shippingDays: 1, skuCode: null, imageIds: [id] } },
  review: { serviceId: id, requestId: 'finite', action: 'draft' }, execute: { serviceId: id, operationId: id, expectedScopeHash: hash, requestId: 'finite' },
  reconcile: { serviceId: id, operationId: id, expectedScopeHash: hash, requestId: 'finite' }, result: { serviceId: id } };
let cases = 0;
for (const [method, input] of Object.entries(goods)) {
  const schema = SHOPIFY_PRODUCT_INPUTS[method]; assert.equal(check(schema, input), true, method); assert.deepEqual(validateShopifyProductInput(method, input), input); cases++;
  for (const bad of [null, [], { ...input, confirmed: true }, { ...input, credentials: {} }, { ...input, approved: true }]) {
    assert.equal(check(schema, bad), false, method); assert.throws(() => validateShopifyProductInput(method, bad)); cases++;
  }
}
for (const value of [{ ...goods.propose, sourceHash: 'bad' }, { ...goods.propose, draft: { ...goods.propose.draft, consumerPrice: '1e3' } },
  { ...goods.propose, draft: { ...goods.propose.draft, imageIds: [id, id] } }, { ...goods.execute, requestId: 'bad request' }]) {
  const method = value.draft ? 'propose' : 'execute'; assert.equal(check(SHOPIFY_PRODUCT_INPUTS[method], value), false); assert.throws(() => validateShopifyProductInput(method, value)); cases++;
}
// Cross-field/business constraints remain explicit beyond JSON Schema.
for (const [method, input] of [['review', { ...goods.review, action: 'publish' }], ['review', { ...goods.review, publicationId: 'gid://shopify/Publication/7' }],
  ['propose', { ...goods.propose, draft: { ...goods.propose.draft, consumerPrice: '0' } }]]) {
  assert.equal(check(SHOPIFY_PRODUCT_INPUTS[method], input), true); assert.throws(() => validateShopifyProductInput(method, input));
}
console.log(JSON.stringify({ engine, cases, explicitBusinessConstraints: 3, modelCalls: 0 }));
