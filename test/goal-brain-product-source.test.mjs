import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusinessBrainProductSourceAdapter } from '../server/goal-brain-product-source.mjs';

const now = Date.parse('2026-10-16T12:00:00.000Z');
const fullProduct = {
  id:'11111111-1111-4111-8111-111111111111', revision:3, companyId:'company', name:'Rayon', description:'Fabric', category:'Textile', status:'draft',
  skus:[{id:'sku',code:'RAYON',specs:['120gsm'],unit:'m',moq:1000,leadTimeDays:25,pricingMode:'tiered',priceTiers:[{minQuantity:1000,unitPriceMinor:180}],pricingNote:''}],
  images:[{id:'img'}], supply:{packaging:'roll',samplePolicy:'500m',paymentTerms:'T/T',shippingTerms:'FOB',capacityNote:'10000m'}, documents:[{documentId:'doc',documentVersion:1,purpose:'spec'}], source:{kind:'user_provided'}
};
const incomplete = { ...fullProduct, id:'22222222-2222-4222-8222-222222222222', name:'', skus:[], images:[], documents:[], supply:{...fullProduct.supply, paymentTerms:''} };
const publicReference = { ...incomplete, id:'33333333-3333-4333-8333-333333333333', name:'Public sample', skus:fullProduct.skus, description:'Reference', images:[{id:'img'}], documents:[{documentId:'doc',documentVersion:1,purpose:'spec'}], source:{kind:'public_reference',sourceUrl:'https://example.com',fetchedAt:'2026-10-16T00:00:00Z',batchId:'b'} };
const archived = { ...fullProduct, id:'44444444-4444-4444-8444-444444444444', status:'archived' };
const state={meta:{sequence:8},businessLibrary:{version:1,company:{id:'company'},products:[fullProduct,incomplete,publicReference,archived],documents:[],operations:[],conversationReferences:[]}};
const identity={workspaceId:'A',subject:'merchant'};
const adapter=createBusinessBrainProductSourceAdapter({store:{read:()=>state},workspaceId:'A',clock:()=>now});

test('projects existing Product Library readiness as one enterprise aggregate',async()=>{
  const refs=await adapter.list({identity});
  assert.equal(refs.length,1);
  const row=await adapter.read({identity,reference:refs[0]});
  assert.equal(row.values.metricType,'product-completeness-v1');
  assert.equal(row.values.total,4);
  assert.equal(row.values.active,3);
  assert.equal(row.values.archived,1);
  assert.equal(row.values.incomplete,1);
  assert.equal(row.values.complete,2);
  assert.equal(row.values.missingImages,1);
  assert.equal(row.values.missingSkus,1);
  assert.equal(row.values.missingDocuments,1);
  assert.equal(row.values.missingSupply,1);
  assert.equal(row.values.asOf,'2026-10-16T12:00:00.000Z');
  assert.equal(Object.keys(row.values).includes('description'),false);
});

test('public-reference product is not incomplete only because enterprise supply is unavailable',async()=>{
  const row=await adapter.read({identity,reference:(await adapter.list({identity}))[0]});
  assert.equal(row.values.incomplete,1);
  assert.equal(row.values.missingSupply,1);
});

test('enterprise scope mismatch fails closed',async()=>{
  await assert.rejects(()=>adapter.list({identity:{workspaceId:'B',subject:'merchant'}}),e=>e.code==='BRAIN_SOURCE_SCOPE_MISMATCH');
});

test('current detects aggregate value changes through SHA',async()=>{
  const ref=(await adapter.list({identity}))[0];
  const expected=await adapter.read({identity,reference:ref});
  state.businessLibrary.products[1].description='now complete';state.meta.sequence++;
  assert.throws(()=>adapter.current({identity,reference:ref,expected}),e=>e.code==='BRAIN_SOURCE_CHANGED');
});
test('product list/read/current remains stable within the explicit observation hour',async()=>{
 let clock=now+123;const adapter=createBusinessBrainProductSourceAdapter({store:{read:()=>state},workspaceId:'A',clock:()=>clock++});
 const reference=(await adapter.list({identity}))[0];const expected=await adapter.read({identity,reference});
 assert.deepEqual(adapter.current({identity,reference,expected}),expected);
 clock=now+3_600_000;
 assert.throws(()=>adapter.current({identity,reference,expected}),e=>e.code==='BRAIN_SOURCE_CHANGED');
});
