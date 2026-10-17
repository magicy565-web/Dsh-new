// Explicit SDK-only contract check. No authentication, HTTP, DB or product writes.
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createRequire}=require('node:module');
const r=createRequire(path.join(__dirname,'../package.json'));
const validators=require(path.join(path.dirname(r.resolve('@medusajs/medusa')),'api/admin/products/validators.js'));
const sdk=r('@medusajs/framework/workflows-sdk');
const step=require(path.join(path.dirname(r.resolve('@medusajs/core-flows')),'product/workflows/create-products.js')).validateProductInputStep;
// Execute only the original pure validation step, never createProductsWorkflow.
const validate=sdk.createWorkflow('retained-product-input-contract',function(input){step({products:input.products});return new sdk.WorkflowResponse(true);});
const client=import('../../../scripts/medusa-catalog-interactive-smoke.mjs');
test('old payload passes both HTTP schemas but the actual native workflow rejects missing options',async()=>{
  const {productCreatePayload}=await client;
  const {options,variants,...old}=productCreatePayload('workspace-acceptance-native-contract');
  assert.equal(validators.CreateProduct.safeParse(old).success,true);
  assert.equal(validators.AdminCreateProduct().safeParse(old).success,true);
  await assert.rejects(validate().run({input:{products:[old]}}),e=>e.type==='invalid_data'&&/^Product options are not provided for:/.test(e.message));
});
test('actual request builder passes native HTTP schemas and workflow input validation, without price/inventory references',async()=>{
  const {productCreatePayload}=await client;
  const body=productCreatePayload('workspace-acceptance-native-contract');
  assert.equal(validators.CreateProduct.safeParse(body).success,true);
  const parsed=validators.AdminCreateProduct().parse(body);
  assert.equal((await validate().run({input:{products:[parsed]}})).result,true);
  assert.deepEqual(body.variants,[]);assert.equal(body.status,'draft');
  for(const key of ['sales_channels','shipping_profile_id','collection_id'])assert.equal(Object.hasOwn(body,key),false);
  assert.equal(validators.AdminUpdateProduct().safeParse({title:'Synthetic updated',subtitle:'Retained synthetic acceptance'}).success,true);
});
